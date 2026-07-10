const zlib = require('zlib');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value = '') {
  return decodeXml(value.replace(/<[^>]+>/g, ''));
}

function getAttr(tag, attrName) {
  const match = tag.match(new RegExp(`${escapeRegExp(attrName)}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
}

function columnIndex(cellRef = '') {
  const letters = cellRef.match(/[A-Z]+/i)?.[0] || 'A';
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function readZipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;

  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid XLSX file: zip directory not found.');
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = {};
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);

    let data;
    if (compression === 0) {
      data = compressedData;
    } else if (compression === 8) {
      data = zlib.inflateRawSync(compressedData);
    } else {
      data = Buffer.alloc(0);
    }

    entries[fileName] = data.toString('utf8');
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function parseSharedStrings(xml = '') {
  const values = [];
  const itemRegex = /<si\b[\s\S]*?<\/si>/g;
  const matches = xml.match(itemRegex) || [];

  for (const item of matches) {
    const textNodes = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1]));
    values.push(textNodes.join(''));
  }

  return values;
}

function resolveSheetPaths(entries) {
  const workbookXml = entries['xl/workbook.xml'];
  const relsXml = entries['xl/_rels/workbook.xml.rels'];
  if (!workbookXml || !relsXml) return [];

  const relationships = {};
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    relationships[getAttr(tag, 'Id')] = getAttr(tag, 'Target');
  }

  return [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((match, index) => {
    const tag = match[0];
    const relId = getAttr(tag, 'r:id');
    const target = relationships[relId] || `worksheets/sheet${index + 1}.xml`;
    return {
      name: getAttr(tag, 'name') || `Sheet ${index + 1}`,
      path: `xl/${target.replace(/^\/?xl\//, '')}`
    };
  });
}

function parseSheet(xml = '', sharedStrings = []) {
  const rows = [];
  const rowMatches = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];

  for (const rowXml of rowMatches) {
    const row = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) || [];

    for (const cellXml of cellMatches) {
      const startTag = cellXml.match(/<c\b[^>]*>/)?.[0] || '';
      const ref = getAttr(startTag, 'r');
      const type = getAttr(startTag, 't');
      const index = columnIndex(ref);
      const rawValue = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
      const inlineValue = cellXml.match(/<is\b[\s\S]*?<\/is>/)?.[0] || '';

      let value = '';
      if (type === 's') {
        value = sharedStrings[Number(rawValue)] || '';
      } else if (type === 'inlineStr') {
        value = stripTags(inlineValue);
      } else {
        value = decodeXml(rawValue);
      }

      if (value) row[index] = value;
    }

    if (row.some(Boolean)) rows.push(row.map(value => value || ''));
  }

  return rows;
}

function rowsToText(sheetName, rows) {
  const lines = [`Sheet: ${sheetName}`];
  const limit = Math.min(rows.length, 200);

  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex].map(value => String(value).trim()).filter(Boolean);
    if (row.length) lines.push(`Row ${rowIndex + 1}: ${row.join(' | ')}`);
  }

  if (rows.length > limit) {
    lines.push(`... ${rows.length - limit} more rows omitted for brevity.`);
  }

  return lines.join('\n');
}

function parseDelimited(text, delimiter) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 500)
    .map((line, index) => `Row ${index + 1}: ${line.split(delimiter).map(value => value.trim()).join(' | ')}`)
    .join('\n');
}

const spreadsheetService = {
  parseSpreadsheet(buffer, fileName = '') {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const text = parseDelimited(buffer.toString('utf8'), ',');
      return { text, sheets: 1, rows: text ? text.split('\n').length : 0 };
    }

    if (lowerName.endsWith('.tsv')) {
      const text = parseDelimited(buffer.toString('utf8'), '\t');
      return { text, sheets: 1, rows: text ? text.split('\n').length : 0 };
    }

    if (!lowerName.endsWith('.xlsx')) {
      throw new Error('Only .xlsx, .csv, and .tsv spreadsheet files are supported.');
    }

    const entries = readZipEntries(buffer);
    const sharedStrings = parseSharedStrings(entries['xl/sharedStrings.xml'] || '');
    const sheets = resolveSheetPaths(entries);
    const sheetTexts = [];
    let totalRows = 0;

    for (const sheet of sheets) {
      const rows = parseSheet(entries[sheet.path] || '', sharedStrings);
      totalRows += rows.length;
      if (rows.length) sheetTexts.push(rowsToText(sheet.name, rows));
    }

    const text = sheetTexts.join('\n\n');
    if (!text.trim()) {
      throw new Error('No readable spreadsheet cells were found.');
    }

    return { text, sheets: sheets.length, rows: totalRows };
  }
};

module.exports = spreadsheetService;

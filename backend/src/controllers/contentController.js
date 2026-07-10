const chromaService = require('../services/chromaService');
const pdfService = require('../services/pdfService');
const spreadsheetService = require('../services/spreadsheetService');

const contentController = {
  // Ingest text extracted from webpage
  async ingestWebpage(req, res) {
    const { text, url, title, config = {} } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    try {
      console.log(`Ingesting webpage content: "${title || 'Untitled'}" (${url || 'No URL'})`);
      const metadata = {
        source: 'webpage',
        url: url || '',
        title: title || 'Webpage'
      };

      const result = await chromaService.addDocument(text, metadata, 'lakshya_knowledge', config);
      return res.json(result);
    } catch (error) {
      console.error('Webpage ingestion failed:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // Ingest PDF file upload
  async ingestPdf(req, res) {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    try {
      // Config comes as a JSON string from form-data
      let config = {};
      if (req.body.config) {
        try {
          config = JSON.parse(req.body.config);
        } catch (e) {
          console.warn('Failed to parse config from request form-data:', e);
        }
      }

      // Check if we should store the document in ChromaDB (RAG)
      const storeInDb = req.query.store !== 'false' && req.body.store !== 'false';

      console.log(`Parsing uploaded PDF: ${req.file.originalname}`);
      const pdfData = await pdfService.parsePdf(req.file.buffer);
      
      let chunksAdded = 0;
      if (storeInDb) {
        const metadata = {
          source: 'pdf',
          title: req.file.originalname,
          pages: pdfData.numpages
        };
        console.log(`PDF Parsed. Exracted ${pdfData.text.length} characters. Sending to Chroma...`);
        const result = await chromaService.addDocument(pdfData.text, metadata, 'lakshya_knowledge', config);
        chunksAdded = result.chunksAdded;
      } else {
        console.log(`PDF Parsed (${pdfData.text.length} characters). Skipping ChromaDB index storage as requested.`);
      }

      return res.json({
        success: true,
        pages: pdfData.numpages,
        characters: pdfData.text.length,
        chunksAdded: chunksAdded,
        text: storeInDb ? undefined : pdfData.text // Only return raw text if we did NOT store it in the database
      });
    } catch (error) {
      console.error('PDF ingestion failed:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  async ingestSpreadsheet(req, res) {
    if (!req.file) {
      return res.status(400).json({ error: 'No spreadsheet file uploaded.' });
    }

    try {
      let config = {};
      if (req.body.config) {
        try {
          config = JSON.parse(req.body.config);
        } catch (e) {
          console.warn('Failed to parse config from request form-data:', e);
        }
      }

      const storeInDb = req.query.store !== 'false' && req.body.store !== 'false';
      const spreadsheetData = spreadsheetService.parseSpreadsheet(req.file.buffer, req.file.originalname);

      let chunksAdded = 0;
      if (storeInDb) {
        const metadata = {
          source: 'spreadsheet',
          title: req.file.originalname,
          sheets: spreadsheetData.sheets,
          rows: spreadsheetData.rows
        };
        const result = await chromaService.addDocument(spreadsheetData.text, metadata, 'lakshya_knowledge', config);
        chunksAdded = result.chunksAdded;
      }

      return res.json({
        success: true,
        sheets: spreadsheetData.sheets,
        rows: spreadsheetData.rows,
        characters: spreadsheetData.text.length,
        chunksAdded,
        text: storeInDb ? undefined : spreadsheetData.text
      });
    } catch (error) {
      console.error('Spreadsheet ingestion failed:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};

module.exports = contentController;

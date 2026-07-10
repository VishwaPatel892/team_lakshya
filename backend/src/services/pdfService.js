const pdfParse = require('pdf-parse');

const pdfService = {
  // Parse PDF file buffer and extract raw text
  async parsePdf(fileBuffer) {
    try {
      const data = await pdfParse(fileBuffer);
      return {
        text: data.text,
        info: data.info || {},
        numpages: data.numpages || 1
      };
    } catch (error) {
      console.error('Error parsing PDF buffer:', error);
      throw new Error(`Failed to parse PDF document: ${error.message}`);
    }
  }
};

module.exports = pdfService;

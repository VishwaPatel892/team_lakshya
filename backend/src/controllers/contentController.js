const chromaService = require('../services/chromaService');
const pdfService = require('../services/pdfService');

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

      console.log(`Parsing uploaded PDF: ${req.file.originalname}`);
      const pdfData = await pdfService.parsePdf(req.file.buffer);
      
      const metadata = {
        source: 'pdf',
        title: req.file.originalname,
        pages: pdfData.numpages
      };

      console.log(`PDF Parsed. Exracted ${pdfData.text.length} characters. Sending to Chroma...`);
      const result = await chromaService.addDocument(pdfData.text, metadata, 'lakshya_knowledge', config);

      return res.json({
        success: true,
        pages: pdfData.numpages,
        characters: pdfData.text.length,
        chunksAdded: result.chunksAdded
      });
    } catch (error) {
      console.error('PDF ingestion failed:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};

module.exports = contentController;

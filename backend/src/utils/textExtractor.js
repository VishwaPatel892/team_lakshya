const textExtractor = {
  // Cleans up raw text, normalizing whitespaces and empty lines
  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n') // replace excessive newlines
      .replace(/[ \t]+/g, ' ')      // normalize spaces
      .trim();
  }
};

module.exports = textExtractor;

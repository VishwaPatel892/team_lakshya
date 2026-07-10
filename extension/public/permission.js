document.getElementById('grant-btn').addEventListener('click', () => {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      stream.getTracks().forEach(track => track.stop());
      // Close the tab once permission is granted
      window.close();
    })
    .catch((err) => {
      console.error(err);
      alert('Microphone permission is required for voice features. Please check your browser settings.');
    });
});

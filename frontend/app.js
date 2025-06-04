import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';

function App() {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [template, setTemplate] = useState('default');
  const [largeText, setLargeText] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  // Initialize WebSocket connection
  const socket = io('http://64.227.183.31:5000');

  // Listen for progress updates from the backend
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    socket.on('progress', (data) => {
      console.log('Progress:', data.percentage);
      const percentage = Math.min(Math.max(data.percentage, 0), 100);
      setProgress(percentage);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });

    return () => {
      socket.off('connect');
      socket.off('progress');
      socket.off('disconnect');
    };
  }, [socket]);

  const speak = (text) => {
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }, 500);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setError('');
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (droppedFile.type.startsWith('video/')) {
        if (droppedFile.size <= 500 * 1024 * 1024) {
          setFile(droppedFile);
          speak('Video uploaded successfully');
        } else {
          setError('File size exceeds 500MB limit');
          speak('File size exceeds 500MB limit');
        }
      } else {
        setError('Please upload a valid video file (MP4, AVI, MOV)');
        speak('Please upload a valid video file');
      }
    }
  };

  const handleFileChange = (e) => {
    setError('');
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type.startsWith('video/')) {
        if (selectedFile.size <= 500 * 1024 * 1024) {
          setFile(selectedFile);
          speak('Video uploaded successfully');
        } else {
          setError('File size exceeds 500MB limit');
          speak('File size exceeds 500MB limit');
        }
      } else {
        setError('Please upload a valid video file (MP4, AVI, MOV)');
        speak('Please upload a valid video file');
      }
    }
  };

  const processVideo = async (action) => {
    if (!file) {
      setError('Please upload a video first');
      speak('Please upload a video first');
      return;
    }

    setProgress(0);
    speak(`Starting ${action}`);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const response = await fetch(`/api/upload?action=${action}`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setProgress(100);
        setDownloadUrl(data.url);
        speak('Processing complete. Download link available.');
      } else {
        setError(data.error || 'Processing failed');
        setProgress(0);
        speak('Processing failed');
      }
    } catch (err) {
      setError('Failed to connect to the server: ' + err.message);
      setProgress(0);
      speak('Failed to connect to the server');
    }
  };

  const handleDownload = async (url) => {
    try {
      speak('Downloading processed video');
      const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch video from backend');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `processed-video-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setError('Failed to download video: ' + error.message);
      speak('Failed to download video');
    }
  };

  useEffect(() => {
    if (!file) {
      setProgress(0);
      setError('');
      setDownloadUrl('');
    }
  }, [file]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const templateStyles = {
    default: 'border-gray-300 bg-white',
    school: 'border-blue-300 bg-blue-50',
    birthday: 'border-pink-300 bg-pink-50'
  };

  return (
    <div
      className={`p-6 max-w-2xl mx-auto min-h-screen flex flex-col items-center ${
        largeText ? 'text-2xl' : 'text-base'
      } ${templateStyles[template]}`}
    >
      <h1 className="text-4xl font-bold mb-6 text-center text-gray-800">
        iCompressVideo
      </h1>

      <div
        className={`border-4 border-dashed p-8 mb-6 rounded-lg text-center w-full max-w-md transition-colors duration-300 ${
          isDragging ? 'border-blue-500 bg-blue-100' : 'border-gray-400'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <p className="mb-4 text-gray-600 font-medium">
          {isDragging ? 'Drop your video here' : 'Drag & drop your video here'}
        </p>
        <label className="cursor-pointer inline-block">
          <input
            type="file"
            accept="video/mp4,video/avi,video/mov"
            onChange={handleFileChange}
            className="hidden"
          />
          <span className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors">
            Choose File
          </span>
        </label>
        <p className="mt-2 text-gray-500">{file ? file.name : 'No file chosen'}</p>
      </div>

      {error && (
        <p className="text-red-500 mb-6 font-medium">{error}</p>
      )}

      {file && !error && (
        <p className="mb-6 text-gray-700">
          Selected: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
        </p>
      )}

      <div className="mb-6 w-full max-w-md">
        <label className="block mb-2 font-semibold text-gray-800">Choose Template:</label>
        <select
          className="border-2 border-gray-300 p-2 rounded-lg w-full bg-white focus:outline-none focus:border-blue-500 transition-colors"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            speak(`Selected ${e.target.value} template`);
          }}
        >
          <option value="default">Default</option>
          <option value="school">School Project</option>
          <option value="birthday">Birthday Video</option>
        </select>
      </div>

      <div className="flex gap-4 mb-6 justify-center">
        <button
          className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors font-semibold"
          onClick={() => processVideo('compress')}
          disabled={!!error}
        >
          Compress
        </button>
        <button
          className="bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors font-semibold"
          onClick={() => processVideo('convert')}
          disabled={!!error}
        >
          Convert
        </button>
        <button
          className="bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors font-semibold"
          onClick={() => processVideo('trim')}
          disabled={!!error}
        >
          Trim
        </button>
      </div>

      {progress > 0 && (
        <div className="w-full max-w-md bg-gray-200 rounded-full h-4 mb-6">
          <div
            className="bg-blue-500 h-4 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          >
            <span className="text-xs text-white font-medium pl-2">{Math.round(progress)}%</span>
          </div>
        </div>
      )}

      {downloadUrl && (
        <div className="mb-6 text-center flex gap-4 justify-center">
          <button
            className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-colors font-semibold"
            onClick={() => handleDownload(downloadUrl)}
          >
            Download Processed Video
          </button>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors font-semibold"
            onClick={() => speak('Playing processed video')}
          >
            Play Processed Video
          </a>
        </div>
      )}

      <div className="text-center">
        <button
          className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-colors font-semibold"
          onClick={() => {
            setLargeText(!largeText);
            speak(largeText ? 'Normal text enabled' : 'Large text enabled');
          }}
        >
          {largeText ? 'Normal Text' : 'Large Text'}
        </button>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

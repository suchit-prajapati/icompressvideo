const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

// Create Express App
const app = express();

// Create HTTP server manually
const http = require('http');
const server = http.createServer(app);

// Attach Socket.IO to server
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: ['http://64.227.183.31', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Enable CORS
app.use(cors({
  origin: ['http://64.227.183.31', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Cloudflare R2 S3 Client Setup
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (
    file.mimetype.startsWith('video/') ||
    ext === '.mp4' ||
    ext === '.avi' ||
    ext === '.mov'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Please upload a valid video file (MP4, AVI, MOV)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

// Ensure processed directory exists
const processedDir = path.join(__dirname, 'processed');
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir);
}

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'iCompressVideo Backend is running!', status: 'OK', timestamp: new Date().toISOString() });
});

// Upload to R2
const uploadToR2 = async (filePath, fileName) => {
  try {
    const fileStream = fs.createReadStream(filePath);
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: fileStream,
      ContentType: 'video/mp4',
    };

    console.log('Uploading to R2:', fileName);
    await s3Client.send(new PutObjectCommand(uploadParams));
    const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileName });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log('R2 Upload Successful:', signedUrl);
    return signedUrl;
  } catch (error) {
    console.error('R2 Upload Failed:', error.message);
    throw error;
  }
};

// Upload endpoint with FFmpeg + progress emit
app.post('/api/upload', upload.single('video'), async (req, res) => {
  let outputPath; // Declare outputPath outside try block for cleanup
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const outputFileName = `${Date.now()}-processed.mp4`;
    outputPath = path.join(processedDir, outputFileName);

    const action = req.query.action || 'compress';
    const ffmpegCommand = ffmpeg(inputPath);

    if (action === 'compress') {
      ffmpegCommand
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate('1000k')
        .outputOptions('-crf 28');
    } else if (action === 'convert') {
      ffmpegCommand
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4');
    } else if (action === 'trim') {
      const start = req.query.start || '0';
      const duration = req.query.duration || '10';
      ffmpegCommand
        .setStartTime(start)
        .setDuration(duration)
        .videoCodec('libx264')
        .audioCodec('aac');
    }

    // Promisify FFmpeg
    await new Promise((resolve, reject) => {
      ffmpegCommand
        .on('progress', (progress) => {
          const percentage = progress.percent || 0;
          io.emit('progress', { percentage: Math.min(Math.max(percentage, 0), 100) });
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error('Video processing failed: ' + err.message)))
        .output(outputPath)
        .run();
    });

    // Upload to R2
    const r2Url = await uploadToR2(outputPath, outputFileName);
    if (!r2Url) {
      throw new Error('Failed to upload processed video to R2');
    }

    // Clean up files
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    res.json({ success: true, url: r2Url });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Direct download by streaming from R2
app.get('/download', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ success: false, error: 'No URL provided' });
    }

    // Fetch the video from R2 URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch video from R2');
    }

    // Set headers for video download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="processed-video-${Date.now()}.mp4"`);

    // Stream the video to the client
    response.body.pipe(res);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to download video: ' + error.message });
  }
});

// Start HTTP + Socket.IO server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server + Socket.IO running on port ${PORT}`);
});
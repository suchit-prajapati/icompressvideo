const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Enable CORS
app.use(cors({
  origin: ['http://64.227.183.31', 'http://localhost:3000'], // Add http:// prefix
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Configure Cloudflare R2 (using AWS SDK)
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Configure Multer for file uploads
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
  console.log('File MIME type:', file.mimetype);
  const ext = path.extname(file.originalname).toLowerCase();
  console.log('File extension:', ext);
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

// Multer error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Serve static files (for processed videos)
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Create processed directory if it doesn't exist
const processedDir = path.join(__dirname, 'processed');
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir);
}

// Root route for GET /
app.get('/', (req, res) => {
  res.status(200).json({ message: 'iCompressVideo Backend is running!', status: 'OK', timestamp: new Date().toISOString() });
});

// Upload file to R2
const uploadToR2 = async (filePath, fileName) => {
  try {
    const fileStream = fs.createReadStream(filePath);
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: fileStream,
      ContentType: 'video/mp4',
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log('R2 Upload Success:', fileName);

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return signedUrl;
  } catch (error) {
    console.error('R2 Upload Failed:', error);
    throw new Error('Failed to upload to R2: ' + error.message);
  }
};

// Endpoint to upload and process video
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const outputFileName = `${Date.now()}-processed.mp4`;
    const outputPath = path.join(processedDir, outputFileName);

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

    ffmpegCommand
      .output(outputPath)
      .on('end', async () => {
        try {
          const r2Url = await uploadToR2(outputPath, outputFileName);
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
          res.json({ success: true, url: r2Url });
        } catch (error) {
          console.error('Post-FFmpeg error:', error);
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
          res.status(500).json({ error: 'Failed to upload processed video to R2' });
        }
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        fs.unlinkSync(inputPath);
        res.status(500).json({ error: 'Video processing failed' });
      })
      .run();
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to serve processed videos (optional, for direct download)
app.get('/download', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  try {
    // Redirect the client directly to the presigned URL
    res.redirect(url);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download video: ' + error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); // Add CORS
require('dotenv').config();

const app = express();

// Enable CORS
app.use(cors({
  origin: '64.227.183.31', // Allow requests from frontend
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

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Please upload a valid video file (MP4, AVI, MOV)'));
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

// Serve static files (for processed videos)
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Create processed directory if it doesn't exist
const processedDir = path.join(__dirname, 'processed');
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir);
}

// Add a root route for GET /
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

    // Generate a presigned URL for downloading (valid for 1 hour)
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

    // Determine action (compress, convert, trim) from query params
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

    // Process the video
    ffmpegCommand
      .output(outputPath)
      .on('end', async () => {
        // Upload processed video to R2
        const r2Url = await uploadToR2(outputPath, outputFileName);

        // Clean up local files
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        res.json({ success: true, url: r2Url });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        fs.unlinkSync(inputPath);
        res.status(500).json({ error: 'Video processing failed' });
      })
      .run();
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
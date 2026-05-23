import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const IMAGE_BASE = process.env.IMAGE_BASE_URL || 'http://localhost:3000';

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export async function uploadToPicGo(filePath) {
  try {
    const ext = path.extname(filePath) || '.jpg';
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    const dest = path.join(UPLOAD_DIR, name);
    fs.copyFileSync(filePath, dest);
    const url = IMAGE_BASE + '/images/' + name;
    return { url, success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


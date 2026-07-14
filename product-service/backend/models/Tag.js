import mongoose from 'mongoose';

const TagSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, index: true },
  color: { type: String, default: '' },
  bg: { type: String, default: '' },
  border: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  usageCount: { type: Number, default: 0 },
}, { collection: 'tags' });

export default mongoose.models.Tag || mongoose.model('Tag', TagSchema);

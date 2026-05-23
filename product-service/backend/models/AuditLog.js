import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  userId: String,
  username: String,
  productId: String,
  details: mongoose.Schema.Types.Mixed,
  ip: String,
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);

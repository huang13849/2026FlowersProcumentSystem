import mongoose from 'mongoose';

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;
  
  // Primary URI for writes, with readPreference=secondary for reads
  const uri = process.env.MONGODB_URI || 'mongodb://100.67.126.90:27017/supply_chain';
  
  // Build connection options
  const opts = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    readPreference: 'secondary',  // Read from secondaries by default
    maxPoolSize: 20,
  };

  try {
    await mongoose.connect(uri, opts);
    isConnected = true;
    console.log('MongoDB connected (write: rpi8, read: rpi4 secondary):', uri.replace(/\/\/.*@/, '//'));
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
  
  mongoose.connection.on('disconnected', () => { isConnected = false; });
}

import 'dotenv/config';
import mongoose from 'mongoose';
import User from './models/User.js';
import Product from './models/Product.js';

async function seed() {
  const uri = process.env.MONGODB_URI_FALLBACK || 'mongodb://100.67.126.90:27017/supply_chain';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  
  // Create admin user
  const existing = await User.findOne({ username: 'admin' });
  if (!existing) {
    await User.create({
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      displayName: '系统管理员',
    });
    console.log('Admin user created (admin / admin123)');
  } else {
    console.log('Admin user already exists');
  }
  
  // Create operator user
  const op = await User.findOne({ username: 'operator' });
  if (!op) {
    await User.create({
      username: 'operator',
      password: 'operator123',
      role: 'operator',
      displayName: '操作员',
    });
    console.log('Operator user created (operator / operator123)');
  }
  
  // Add sample product
  const count = await Product.countDocuments();
  if (count === 0) {
    await Product.create({
      title: '示例商品 - 玫瑰鲜花',
      category: '花卉',
      sellerName: '示例供应商',
      flowerName: '玫瑰',
      stock: 100,
      costPrice: 15,
      sellPrice: 29.9,
      profit: 14.9,
      description: '这是一条示例商品数据，用于测试系统功能',
    });
    console.log('Sample product created');
  }
  
  await mongoose.disconnect();
  console.log('Seed complete');
}

seed().catch(err => { console.error(err); process.exit(1); });


import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
const c = new MongoClient("mongodb://100.67.126.90:27017/supply_chain");
await c.connect();
const db = c.db();
const u = db.collection("users");
u.deleteMany({});
const ap = await bcrypt.hash("admin123", 10);
const op = await bcrypt.hash("operator123", 10);
u.insertOne({username:"admin",password:ap,role:"admin",displayName:"系统管理员",createdAt:new Date()});
u.insertOne({username:"operator",password:op,role:"operator",displayName:"操作员",createdAt:new Date()});
console.log("Users:", await u.countDocuments());
const p = db.collection("products");
p.deleteMany({});
p.insertMany([
  {title:"红玫瑰-卡罗拉",category:"花卉",sellerName:"云南花农",flowerName:"卡罗拉玫瑰",stock:200,costPrice:12,sellPrice:29.9,profit:17.9,isListed:false,images:[],createdAt:new Date(),updatedAt:new Date()},
  {title:"白百合-西伯利亚",category:"花卉",sellerName:"昆明花卉基地",flowerName:"西伯利亚百合",stock:150,costPrice:18,sellPrice:39.9,profit:21.9,isListed:false,images:[],createdAt:new Date(),updatedAt:new Date()},
  {title:"绣球花-无尽夏",category:"花卉",sellerName:"浙江花圃",flowerName:"无尽夏绣球",stock:80,costPrice:25,sellPrice:55.0,profit:30.0,isListed:false,images:[],createdAt:new Date(),updatedAt:new Date()},
]);
console.log("Products:", await p.countDocuments());
await c.close();


const { Client: MinioClient } = require("minio");

const endpoint = process.env.MINIO_ENDPOINT || "minio:9000";
const bucket = process.env.MINIO_BUCKET || "supply-chain";
const publicUrl = process.env.MINIO_PUBLIC_URL || "http://100.96.54.109:9000";

const client = new MinioClient({
  endPoint: endpoint.split(":")[0],
  port: parseInt(endpoint.split(":")[1] || "9000"),
  useSSL: endpoint.startsWith("https"),
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

const ensureBucket = async () => {
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket);
    console.log("Bucket created:", bucket);
  }
};

const uploadFile = async ({ buffer, filename, mimetype, folder = "contracts" }) => {
  const key = folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + filename;
  await client.putObject(bucket, key, buffer, null, { "Content-Type": mimetype });
  const url = publicUrl + "/" + bucket + "/" + key;
  return { key, url };
};

const deleteFile = async (url) => {
  try {
    const key = url.split("/" + bucket + "/")[1];
    if (!key) return;
    await client.removeObject(bucket, key);
  } catch (err) {
    console.error("MinIO delete error:", err.message);
  }
};

const getPresignedUrl = async (key, expiresIn = 3600) => {
  return client.presignedGetObject(bucket, key, expiresIn);
};

ensureBucket().catch(err => console.error("MinIO init:", err.message));

module.exports = { uploadFile, deleteFile, getPresignedUrl };

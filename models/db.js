import mongoose from "mongoose";

let cached = global.mongoose;

if (!cached) cached = global.mongoose = { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) {
    return cached.conn; // reuse existing connection
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONOGO_URL, {
      bufferCommands: false,
    }).then((db) => {
      console.log("✅ MongoDB connected");
      return db;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

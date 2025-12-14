import mongoose from "mongoose";

let isConnected = false; // track connection

export async function connectDB() {
  if (isConnected) {
    // Already connected
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONOGO_URL, {
      bufferCommands: false, // fail immediately if DB not connected
    });
    isConnected = db.connections[0].readyState === 1;
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    throw err;
  }
}

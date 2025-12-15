import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true
    },
    time: {
      type: String,
      required: true
    }
  },
  { timestamps: false }
);

const Transaction = mongoose.model("transaction", transactionSchema);

export default Transaction;

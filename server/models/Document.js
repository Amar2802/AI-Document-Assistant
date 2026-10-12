
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      maxlength: 255,
    },
    mimeType: {
      type: String,
      default: "application/pdf",
    },
    size: {
      type: Number,
      required: true,
    },
    pageCount: {
      type: Number,
      required: true,
    },
    chunkCount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["processed"],
      default: "processed",
    },
  },
  { timestamps: true }
);

documentSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);


const mongoose = require("mongoose");

const chunkSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    page: {
      type: Number,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) =>
          Array.isArray(value) && value.length === 1536,
        message: "Embedding must contain 1536 values",
      },
    },
  },
  { timestamps: true }
);

chunkSchema.index({ owner: 1, documentId: 1 });

module.exports = mongoose.model("Chunk", chunkSchema);

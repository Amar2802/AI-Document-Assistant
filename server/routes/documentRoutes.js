
const express = require("express");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");

const Document = require("../models/Document");
const Chunk = require("../models/Chunk");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, callback) {
    if (path.extname(file.originalname).toLowerCase() !== ".pdf") {
      return callback(new Error("Only PDF files are supported"));
    }

    callback(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const status =
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400;

      return res.status(status).json({
        message: error.message || "Invalid file upload",
      });
    }

    next();
  });
}

async function getEmbeddings(texts) {
  const response = await fetch(
    `${process.env.AI_SERVICE_URL}/embed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": process.env.AI_SERVICE_TOKEN,
      },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(60000),
    }
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.detail || body.message || "Embedding request failed"
    );
  }

  if (
    !Array.isArray(body.embeddings) ||
    body.embeddings.length !== texts.length
  ) {
    throw new Error("The embedding service returned an invalid response");
  }

  return body.embeddings;
}

// POST /api/documents
router.post("/", authenticateToken, handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: 'Select a PDF using the "file" field',
    });
  }

  let document;

  try {
    const form = new FormData();

    form.append(
      "file",
      new Blob([req.file.buffer], { type: "application/pdf" }),
      path.basename(req.file.originalname)
    );

    const extractionResponse = await fetch(
      `${process.env.AI_SERVICE_URL}/extract`,
      {
        method: "POST",
        headers: {
          "X-Internal-Token": process.env.AI_SERVICE_TOKEN,
        },
        body: form,
        signal: AbortSignal.timeout(60000),
      }
    );

    const extracted = await extractionResponse.json().catch(() => ({}));

    if (!extractionResponse.ok) {
      return res.status(extractionResponse.status).json({
        message: extracted.detail || "PDF extraction failed",
      });
    }

    if (
      !Array.isArray(extracted.chunks) ||
      extracted.chunks.length === 0
    ) {
      return res.status(422).json({
        message: "No extractable text was found in the PDF",
      });
    }

    document = await Document.create({
      owner: req.userId,
      originalName: path.basename(req.file.originalname).slice(0, 255),
      mimeType: "application/pdf",
      size: req.file.size,
      pageCount: extracted.pageCount,
      chunkCount: extracted.chunks.length,
      status: "processed",
    });

    // Generate and save embeddings in small batches.
    const batchSize = 32;

    for (
      let start = 0;
      start < extracted.chunks.length;
      start += batchSize
    ) {
      const batch = extracted.chunks.slice(start, start + batchSize);

      const embeddings = await getEmbeddings(
        batch.map((chunk) => chunk.text)
      );

      const records = batch.map((chunk, index) => ({
        owner: req.userId,
        documentId: document._id,
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        embedding: embeddings[index],
      }));

      await Chunk.insertMany(records);
    }

    return res.status(201).json({
      message: "PDF uploaded, processed, and embedded successfully",
      document: {
        id: document._id,
        name: document.originalName,
        size: document.size,
        pageCount: document.pageCount,
        chunkCount: document.chunkCount,
        status: document.status,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    
    console.error("Document processing error:", error);
    console.error("Underlying cause:", error.cause);
    console.error("Error name:", error.name);
    console.error("Error code:", error.code);

    // Roll back partial ingestion so a failed upload is not left incomplete.
    if (document) {
      await Chunk.deleteMany({
        owner: req.userId,
        documentId: document._id,
      }).catch(() => {});

      await Document.deleteOne({
        _id: document._id,
        owner: req.userId,
      }).catch(() => {});
    }

    const timedOut =
      error.name === "TimeoutError" ||
      error.name === "AbortError";

    return res.status(timedOut ? 504 : 502).json({
      message: timedOut
        ? "Document processing timed out. Please try again."
        : "Unable to process the PDF or generate embeddings",
    });
  }
});

// GET /api/documents — list only the logged-in user's documents
router.get("/", authenticateToken, async (req, res) => {
  try {
    const documents = await Document.find({
      owner: req.userId,
    })
      .select("originalName size pageCount chunkCount status createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      documents: documents.map((document) => ({
        id: document._id,
        name: document.originalName,
        size: document.size,
        pageCount: document.pageCount,
        chunkCount: document.chunkCount,
        status: document.status,
        createdAt: document.createdAt,
      })),
    });
  } catch (error) {
    console.error("Document listing error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve documents",
    });
  }
});

// POST /api/documents/:documentId/search
// Retrieve semantically relevant passages from one of the user's documents.
router.post(
  "/:documentId/search",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.documentId)) {
        return res.status(400).json({
          message: "Invalid document ID",
        });
      }

      const query = req.body?.query;

      if (
        typeof query !== "string" ||
        query.trim().length < 3 ||
        query.trim().length > 1000
      ) {
        return res.status(400).json({
          message: "Query must contain 3–1000 characters",
        });
      }

      const document = await Document.findOne({
        _id: req.params.documentId,
        owner: req.userId,
      }).select("_id originalName");

      if (!document) {
        return res.status(404).json({
          message: "Document not found",
        });
      }

      const [queryEmbedding] = await getEmbeddings([query.trim()]);

      const matches = await Chunk.aggregate([
        {
          $vectorSearch: {
            index: "chunk_embedding_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: 100,
            limit: 5,
            filter: {
              owner: {
                $eq: new mongoose.Types.ObjectId(req.userId),
              },
              documentId: {
                $eq: document._id,
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            text: 1,
            page: 1,
            chunkIndex: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ]);

      return res.json({
        document: {
          id: document._id,
          name: document.originalName,
        },
        query: query.trim(),
        matches,
      });
    } catch (error) {
      console.error("Semantic search error:", error.message);

      return res.status(500).json({
        message:
          "Search failed. Check the embedding service and Atlas Vector Search index.",
      });
    }
  }
);

module.exports = router;

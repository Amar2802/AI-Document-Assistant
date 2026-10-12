const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = authorization.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!payload.sub) {
      return res.status(401).json({
        message: "Invalid authentication token",
      });
    }

    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

module.exports = authenticateToken;
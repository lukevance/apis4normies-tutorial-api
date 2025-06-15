const crypto = require('crypto');
const bcrypt = require('bcrypt');

// function for creating API keys for users
function generateApiKey() {
  const prefix = 'normie_key_';
  const randomPart = crypto.randomBytes(15).toString('base64url'); // Shorter, readable, URL-safe
  return prefix + randomPart;
}

// Middleware to fetch user and attach hashedApiKey to req
async function attachUserByApiKey(req, res, next) {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  try {
    const user = await getUserByApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.user = user;
    req.hashedApiKey = user.hashedApiKey; // Attach to req for verifyAPIKey
    next();
  } catch (err) {
    next(err);
  }
}

// functionfor verifying API key
async function verifyApiKey(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const providedKey = authHeader.split(' ')[1];

  try {
    const isValid = await bcrypt.compare(providedKey, req.user.hashedApiKey);

    if (!isValid) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    next(); // Auth success
  } catch (err) {
    console.error('API key verification error:', err);
    res.status(500).json({ error: 'Server error validating API key' });
  }
};

module.exports = {
  generateApiKey,
  verifyApiKey
};
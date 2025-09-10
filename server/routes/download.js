const router = require('express').Router();
const fs = require('fs'); // Correct way to require fs
const {
  readFileSync,
  createWriteStream,
  unlink,
  readdirSync,
  rmSync,
  unlinkSync
} = fs;
const jscrypt = require('jscrypt');
const { Magic } = require('@magic-sdk/admin');
const { ThirdwebStorage } = require('@thirdweb-dev/storage');
const path = require('path');
const User = require('../models/user');
const AppError = require('../util/appError');

const magic = new Magic(process.env.MAGIC_SECRET_KEY);
const storage = new ThirdwebStorage({ secretKey: "wmAxorRmkpQjnd_dLrXePg6VZc1iw4N1lxluT6eAPivXmATaMVixZEZ3yOcxLAUfzPxT7JV9gc8rrXbYGxSBKg" });


async function getFile(cid, encryptedPath) {
  try {
    const fileUrl = await storage.resolveScheme(`ipfs://${cid}/0`);
    console.log("Fetching file from IPFS using Thirdweb CID:", cid);

    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);

    // Convert response body to a buffer
    const buffer = await response.arrayBuffer();
    const data = Buffer.from(buffer);

    // Write buffer to file
    await fs.promises.writeFile(encryptedPath, data);
    console.log("File downloaded successfully:", encryptedPath);
  } catch (error) {
    console.error("Error downloading file:", error);
    throw new AppError(error.message, 500);
  }
}

function decryptAndSendFileInResponse(
  encryptedPath,
  decryptedPath,
  file,
  fileName,
  res,
  next
) {
  try {
    jscrypt.decryptFile(
      encryptedPath,
      decryptedPath,
      'aes256',
      file.encryption_key,
      655000,
      (isDone) => {
        if (isDone === true) {
          console.log(`${fileName} is decrypted successfully!`);
          console.log('Sending files to the user');
          // send the file to the client
          res.sendFile(path.resolve(decryptedPath));

          setTimeout(() => {
            unlink(decryptedPath, (err) => {
              if (err) {
                console.log(err);
              }
              console.log(`${decryptedPath} is deleted!`);
            });

            unlink(encryptedPath, (err) => {
              if (err) {
                console.log(err);
              }
              console.log(`${encryptedPath} is deleted!`);
            });
          }, 2 * 60 * 1000);
        } else {
          console.log('File decryption in progress...');
        }
      }
    );
  } catch (err) {
    console.log(err);
    return next(new AppError(err.message, 500));
  }
}

router.get('/secure/:cid/:auth', async (req, res, next) => {
  console.log('Secure download called');
  const { cid } = req.params;
  const { auth } = req.params;
  const metadata = await magic.users.getMetadataByToken(auth);
  const magic_id = metadata.issuer;

  try {
    const file = await User.findOne(
      { magic_id, files: { $elemMatch: { cid } } },
      { encryption_key: 1 }
    ).select({ files: { $elemMatch: { cid } } });
    if (file) {
      const fileName = file.files[0].file_name;
      const encryptedPath = `../server/private/${fileName}`;
      const decryptedPath = `../server/public/${fileName}`;
      await getFile(cid, encryptedPath).then(async () =>
        decryptAndSendFileInResponse(
          encryptedPath,
          decryptedPath,
          file,
          fileName,
          res,
          next
        )
      );
    } else {
      return res
        .status(200)
        .sendFile('../private/hacker.png', { root: __dirname });
    }
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
});

router.get('/:cid', async (req, res, next) => {
  const { cid } = req.params;
  try {
    const file = await User.findOne(
      { files: { $elemMatch: { cid, public: true } } },
      { encryption_key: 1 }
    ).select({ files: { $elemMatch: { cid, public: true } } });
    if (file) {
      const fileName = file.files[0].file_name;
      const encryptedPath = `../server/encrypted/${fileName}`;
      const decryptedPath = `../server/public/${fileName}`;
      await getFile(cid, encryptedPath).then(async () =>
        decryptAndSendFileInResponse(
          encryptedPath,
          decryptedPath,
          file,
          fileName,
          res,
          next
        )
      );
    } else {
      return res
        .status(200)
        .sendFile('../private/hacker.png', { root: __dirname });
    }
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
});

module.exports = router;

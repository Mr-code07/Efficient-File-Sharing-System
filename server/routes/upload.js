const authMiddleware = require('../middlewares/authMiddleware');
const { Magic } = require('@magic-sdk/admin');
const User = require('../models/user');
const AppError = require('../util/appError');
const router = require('express').Router();
const fs = require('fs'); // Correct way to require fs
const {
  readFileSync,
  createWriteStream,
  unlink,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync
} = fs;

const jscrypt = require('jscrypt');
const { create } = require('ipfs-http-client');

const projectId = process.env.INFURA_PROJECT_ID;
const projectSecret = process.env.INFURA_PROJECT_SECRET;
const auth = `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString(
  'base64'
)}`;

/*
    Connection to the INFURA IPFS node
    Get the secret keys from the INFURA IPFS dashboard
    Website link: https://infura.io/product/ipfs
*/
const magic = new Magic(process.env.MAGIC_SECRET_KEY);

const { ThirdwebStorage } = require('@thirdweb-dev/storage');

const storage = new ThirdwebStorage({ secretKey: "5LwjQnuDPIKdNG7qSO6LUikh_x0AYoTuJsCl_vZ4m28LxRw-Bn45r7_U7GEqzvoY3YW25tZ63dkvCdclqKepAQ" });
const addFile = async (filePath) => {
  console.log(filePath);
  const file = readFileSync(`encrypted/${filePath}`);
  const uri = await storage.upload(file);
  return uri;
};

router.post('/', authMiddleware, async (req, res, next) => {
  const metadata = await magic.users.getMetadataByToken(
    req.headers.authorization.substring(7)
  );
  const user = await User.findOne(
    { magic_id: metadata.issuer },
    { encryption_key: 1, files: 1 }
  );
  console.log(user);
  const updatedFiles = user.files;
  if (metadata.issuer === '') {
    return res.status(500).json({ error: 'User is not authenticated' });
  }
  // console.log(req.files.files);
  let { files } = req.files;
  // if files is not an array, make it an array
  if (!Array.isArray(files)) {
    files = [files];
  }
  try {
    const uploadList = [];
    // iterate req.files and move it to test folder
    for (const file of files) {
      // const file = files[i];
      let fileName = file.name.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      if (file.name !== fileName) {
        fileName = Buffer.from(file.name, 'latin1').toString('utf8');
      }
      const filePath = `../server/private/${fileName}`;
      const encryptedPath = `../server/encrypted/${fileName}`;

      file.mv(filePath, async (err) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: err.message });
        }

        console.log('encrypting file started');
        try {
          jscrypt.encryptFile(
            filePath,
            encryptedPath,
            'aes256',
            user.encryption_key,
            655000,
            async (isDone) => {
              if (isDone === true) {
                console.log(`${fileName} is encrypted successfully!`);

                console.log('Adding files to IFPS in next step');
                console.log(encryptedPath);
                const fileAdded = await addFile(fileName, encryptedPath);
                console.log(fileAdded);

                const fileSize = fs.statSync(encryptedPath).size;
                console.log(`File Size: ${fileSize}`);

                const uri = fileAdded.replace("ipfs://", "").split("/");

                // Fetch metadata
                const uri_metadata = await storage.resolveScheme(fileAdded);
                console.log(uri_metadata);


                const upData = {
                  file_name: fileName,
                  public: false,
                  cid: uri[0],
                  file_creationDate: new Date().toISOString(),
                  file_size: fileSize || 0
                };
                console.log("File Details:", upData);
                uploadList.push(upData);

                const duplicateFileIndex = updatedFiles.findIndex(
                  (file) => file.file_name === upData.file_name
                );

                if (duplicateFileIndex >= 0)
                  updatedFiles[duplicateFileIndex] = upData;
                else updatedFiles.push(upData);

                await User.updateOne(
                  { magic_id: metadata.issuer },
                  { $set: { files: updatedFiles } }
                );

                unlink(filePath, (err) => {
                  if (err) {
                    console.log(err);
                  }
                  console.log(`${filePath} is deleted!`);
                });
                unlink(encryptedPath, (err) => {
                  if (err) {
                    console.log(err);
                  }
                  console.log(`${encryptedPath} is deleted!`);
                });
              } else {
                console.log(`${fileName} is not encrypted!`);
              }
            }
          );
        } catch (error) {
          console.log(error);
          // return res.status(500).json({ error: error.message, message: "Couldn't upload your files at this moment" });
          return next(
            new AppError("Couldn't upload your files at this moment", 500)
          );
        }
      });
    }
    return res
      .status(200)
      .json({ message: 'Files uploaded successfully', uploadList });
  } catch (error) {
    // return res.status(500).json({ error: error.message, message: "Couldn't upload your files at this moment" });
    return next(new AppError("Couldn't upload your files at this moment", 500));
  }
});

module.exports = router;

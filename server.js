require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Load existing token if available
const TOKEN_PATH = path.join(__dirname, "token.json");
if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oauth2Client.setCredentials(token);
}

const drive = google.drive({ version: "v3", auth: oauth2Client });

const ROOT_UPLOAD_DIR = path.join(__dirname, "uploads");
const TMP_UPLOAD_DIR = path.join(ROOT_UPLOAD_DIR, "tmp");

const STORAGE_TARGETS = {
  main: {
    label: "Ana Depolama",
    dir: path.join(ROOT_UPLOAD_DIR, "main"),
  },
  archive: {
    label: "Arsiv Depolama",
    dir: path.join(ROOT_UPLOAD_DIR, "archive"),
  },
};

ensureDir(TMP_UPLOAD_DIR);
Object.values(STORAGE_TARGETS).forEach((target) => ensureDir(target.dir));

const upload = multer({
  dest: TMP_UPLOAD_DIR,
  limits: {
    files: 20,
    fileSize: 200 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const isSupported =
      file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");

    if (!isSupported) {
      callback(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          `${file.originalname} desteklenmeyen bir dosya turu`
        )
      );
      return;
    }

    callback(null, true);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/auth", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.file"],
    prompt: "consent",
  });
  res.redirect(authUrl);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send("Basariyla Google Drive'a baglandiniz. Artik sekmeyi kapatabilirsiniz.");
  } catch (error) {
    console.error("Token verilirken hata olustu:", error);
    res.status(500).send("Kimlik dogrulama sirasinda bir hata olustu.");
  }
});

app.get("/api/storage-targets", (_req, res) => {
  res.json(
    Object.entries(STORAGE_TARGETS).map(([value, target]) => ({
      value,
      label: target.label,
    }))
  );
});

app.post("/api/upload", upload.array("media", 20), async (req, res) => {
  const uploadedFiles = req.files || [];
  const fullName = (req.body.fullName || "").trim();

  if (!fullName) {
    await deleteFiles(uploadedFiles);
    res.status(400).json({ message: "Lutfen ad soyad bilgisini girin." });
    return;
  }

  if (!uploadedFiles.length) {
    res.status(400).json({ message: "En az bir fotograf veya video secin." });
    return;
  }

  try {
    const safeFullName = slugify(fullName);
    
    // Get or Create root folder "Dugun Dosyalari"
    const rootFolderId = await getOrCreateDriveFolder("Dugun Dosyalari");
    
    // Get or Create user folder inside root
    const userFolderId = await getOrCreateDriveFolder(safeFullName, rootFolderId);

    const savedFiles = [];

    for (const file of uploadedFiles) {
      const safeOriginalName = slugify(path.parse(file.originalname).name);
      const extension = path.extname(file.originalname).toLowerCase();
      const finalFileName = `${Date.now()}-${safeOriginalName}${extension}`;

      const fileMetadata = {
        name: finalFileName,
        parents: [userFolderId]
      };
      
      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path)
      };

      const uploadedFile = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name'
      });

      savedFiles.push({
        originalName: file.originalname,
        savedAs: uploadedFile.data.name,
        mimeType: file.mimetype,
      });
      
      // Delete temporary file
      await fs.promises.unlink(file.path).catch(() => {});
    }

    res.status(201).json({
      message: "Dosyalar basariyla Google Drive'a yuklendi.",
      fullName,
      files: savedFiles,
    });
  } catch (error) {
    await deleteFiles(uploadedFiles);
    console.error("Drive upload error:", error);
    res.status(500).json({
      message: "Dosyalar kaydedilirken bir hata olustu. Kimlik dogrulamasi(Auth) tamlanmamis olabilir.",
      detail: error.message,
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Bir dosya 200 MB limitini asti."
        : "Yukleme sirasinda gecerli olmayan bir dosya secildi.";

    res.status(400).json({ message });
    return;
  }

  res.status(500).json({
    message: "Beklenmeyen bir sunucu hatasi olustu.",
    detail: error.message,
  });
});

app.listen(PORT, () => {
  console.log(`Sunucu hazir: http://localhost:${PORT}`);
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

async function deleteFiles(files) {
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.promises.unlink(file.path);
      } catch (_error) {
      }
    })
  );
}

async function getOrCreateDriveFolder(folderName, parentId = null) {
  const query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` + (parentId ? ` and '${parentId}' in parents` : "");
  const response = await drive.files.list({ q: query, fields: 'files(id, name)' });
  
  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }
  
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : []
  };
  
  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id'
  });
  
  return folder.data.id;
}


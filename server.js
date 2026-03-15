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

if (process.env.REFRESH_TOKEN) {
  // Eger Coolify paneline REFRESH_TOKEN eklendiyse, server her basladiginda oradan okur. Asla unutmaz.
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
} else if (fs.existsSync(TOKEN_PATH)) {
  // Lokal gelistirme formati
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
    files: 250,
    fileSize: 2 * 1024 * 1024 * 1024, // 2 GB
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
    
    // Ekranda Refresh Token'ı kullanıcıya göster ki Coolify paneline kopyalayabilsin.
    res.send(`
      <div style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #059669;">✅ Basariyla Google Drive'a Baglandiniz!</h2>
        <p>Ancak, sunucunuzun (Coolify) yeniden baslatmalarda bu onayı unutmamasi icin son bir adim kaldi:</p>
        <p><b>1.</b> Asagidaki uzun kodu kopyalayin.<br><b>2.</b> Coolify panelinizdeki <b>Environment Variables</b> kismina gidin.<br><b>3.</b> <code>REFRESH_TOKEN</code> adinda yepyeni bir degisken ekleyin ve kopyaladiginiz kodu icine yapistirip kaydedin.<br><b>4.</b> Bir kez daha Deploy (Yeniden Kur) tusuna basin.</p>
        <p>Bunu yaptiginizda sistem bir daha size ASLA onay sormayacak, tamamen otomatiklesecektir.</p>
        <textarea style="width: 100%; height: 120px; font-family: monospace; padding: 10px; border-radius: 4px; border: 1px solid #ccc;" readonly>${tokens.refresh_token || "Tekrarlanan deneme. Lutfen Google hesabınızin erisimini kaldirip tekrar deneyin."}</textarea>
      </div>
    `);
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
        ? "Bir dosya 2 GB limitini asti."
        : "Yukleme sirasinda gecerli olmayan bir dosya secildi VEYA dosya adeti limitini (250) astiniz.";

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


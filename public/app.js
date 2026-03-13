const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#media");
const fileList = document.querySelector("#file-list");
const selectionSummary = document.querySelector("#selection-summary");
const statusBox = document.querySelector("#status-box");
const submitButton = document.querySelector("#submit-button");
const dropzone = document.querySelector(".dropzone");

init();

async function init() {
  fileInput.addEventListener("change", renderSelectedFiles);
  form.addEventListener("submit", handleSubmit);
}

function renderSelectedFiles() {
  fileList.innerHTML = "";

  const files = Array.from(fileInput.files || []);
  dropzone.classList.toggle("has-files", files.length > 0);

  if (!files.length) {
    selectionSummary.textContent = "Henuz dosya secilmedi.";
    return;
  }

  const totalSizeMb = (
    files.reduce((total, file) => total + file.size, 0) /
    (1024 * 1024)
  ).toFixed(1);

  selectionSummary.textContent = `${files.length} dosya secildi. Toplam boyut ${totalSizeMb} MB.`;

  files.forEach((file) => {
    const item = document.createElement("li");
    const typeLabel = file.type.startsWith("video/") ? "Video" : "Fotograf";
    const sizeLabel = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    item.innerHTML = `
      <span>${file.name}</span>
      <small>${typeLabel} - ${sizeLabel}</small>
    `;

    fileList.appendChild(item);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  hideStatus();

  const fullName = document.querySelector("#fullName").value.trim();
  const files = Array.from(fileInput.files || []);

  if (!fullName) {
    showStatus("error", "Ad soyad alani bos birakilamaz.");
    return;
  }

  if (!files.length) {
    showStatus("error", "Lutfen en az bir medya dosyasi secin.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Yukleniyor...";

  const formData = new FormData();
  formData.append("fullName", fullName);
  formData.append("storageTarget", "main"); // Sabit olarak ana depolama kullanılıyor

  files.forEach((file) => formData.append("media", file));

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Yukleme basarisiz oldu.");
    }

    form.reset();
    renderSelectedFiles();

    showStatus(
      "success",
      `${result.message} Kayit klasoru: ${result.savedDirectory}`,
      result.files
    );
  } catch (error) {
    showStatus("error", error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Yukle ve Devam Et";
  }
}

function showStatus(type, message, files = []) {
  statusBox.className = `status-box visible ${type}`;

  const fileItems = files.length
    ? `<ul>${files
        .map(
          (file) =>
            `<li>${file.originalName} -> ${file.savedAs}</li>`
        )
        .join("")}</ul>`
    : "";

  statusBox.innerHTML = `<strong>${message}</strong>${fileItems}`;
}

function hideStatus() {
  statusBox.className = "status-box";
  statusBox.innerHTML = "";
}

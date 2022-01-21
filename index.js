const fetch = require('node-fetch');
const { listFolderRecursive } = require('@samwen/fs-utils');
const PDFParser = require('pdf2json');
const fs = require('fs');
const { Translate } = require('@google-cloud/translate').v2;

const FormData = require('form-data');

const gTranslate = new Translate();

const getPath = (fullPath) => {
  const pathEls = fullPath.split('/');
  const outPath = pathEls.slice(0, pathEls.length - 1).join('/');
  const filename = pathEls[pathEls.length - 1];
  const strippedFilename = filename.substring(0, filename.length - 4);

  const dirPath = `${outPath !== '' ? `${outPath}/` : ''}${strippedFilename}`;

  return {
    dirPath,
    filename,
    strippedFilename,
  };
};

const textify = async (pdfPath) => new Promise((ok, nok) => {
  const pdfParser = new PDFParser(this, 1);

  const handlePdfError = async (err) => {
    console.error(JSON.stringify(err, null, 2));
    nok(err.parserError);

    pdfParser.removeAllListeners();
  };

  const handlePdfData = async (data) => {
    try {
      ok(pdfParser.getRawTextContent());
    } catch (ex) {
      console.error(ex);
    } finally {
      pdfParser.removeAllListeners();
    }
  };

  pdfParser.once('pdfParser_dataReady', handlePdfData);
  pdfParser.once('pdfParser_dataError', handlePdfError);

  const fullPdfPath = `${process.env.IN_FOLDER}/${pdfPath}`;

  pdfParser.loadPDF(`${fullPdfPath}`);
});

const summarize = async (text) => {
  const reqUrl = process.env.SUMMARIZATION_ENDPOINT;

  const form = new FormData();
  form.append('key', process.env.SUMMARIZATION_KEY);
  form.append('txt', text);
  form.append('limit', 25);

  const res = await fetch(`${reqUrl}`, {
    method: 'POST',
    body: form,
  });

  const resJson = await res.json();

  const formattedSummary = resJson.summary
    .replaceAll('[...] ', '[...]')
    .replaceAll('[...]', '\n\n');

  return formattedSummary;
};

const translate = async (text) => {
  let [translations] = await gTranslate.translate(text, process.env.LANG);
  translations = Array.isArray(translations) ? translations : [translations];

  translations = translations.join('\n\n');

  return translations;
};

const sleep = async () => new Promise((ok, nok) => {
  setTimeout(() => ok(), 1500);
});

(async () => {
  // Read all files
  const list = listFolderRecursive(`${process.env.IN_FOLDER}`).filter((i) => i.endsWith('pdf'));

  for (let i = 0; i < list.length; i += 1) {
    console.info('Sleeping \n');
    await sleep();

    console.info(`Processing ${list[i]} | (${i + 1} / ${list.length})`);

    const path = getPath(list[i]);

    if (
      !fs.existsSync(
        `${process.env.OUT_FOLDER}/${path.dirPath}/${path.filename}`,
      )
    ) {
      console.info('Copying src file');

      fs.mkdirSync(`${process.env.OUT_FOLDER}/${path.dirPath}`, {
        recursive: true,
      });
      fs.copyFileSync(
        `${process.env.IN_FOLDER}/${list[i]}`,
        `${process.env.OUT_FOLDER}/${path.dirPath}/${path.filename}`,
      );
    } else {
      console.info('Src file copy found. Skipping.');
    }

    let dst;
    let text;
    let summary;
    let translation;

    const dstDirPath = `${process.env.OUT_FOLDER}/${path.dirPath}`;

    // For each file, get contents and save
    try {
      dst = `${process.env.OUT_FOLDER}/${path.dirPath}/${path.strippedFilename}.text.txt`;

      if (!fs.existsSync(dst)) {
        console.info('Generating text');

        fs.mkdirSync(`${dstDirPath}`, { recursive: true });

        text = await textify(path.filename);
        fs.writeFileSync(dst, text);
      } else {
        console.info('Text found. Skipping.');
        text = fs.readFileSync(dst).toString();
      }
    } catch (ex) {
      console.error(ex);
      continue;
    }

    // For each content get summary and save
    try {
      dst = `${process.env.OUT_FOLDER}/${path.dirPath}/${path.strippedFilename}.summary.txt`;

      if (!fs.existsSync(dst)) {
        console.info('Generating summary');

        summary = await summarize(text);
        fs.writeFileSync(dst, summary);
      } else {
        console.info('Summary found. Skipping.');
        summary = fs.readFileSync(dst).toString();
      }
    } catch (ex) {
      console.error(ex);
      continue;
    }

    // For each summary, translate and save
    try {
      dst = `${process.env.OUT_FOLDER}/${path.dirPath}/${path.strippedFilename}.translation.txt`;
      if (!fs.existsSync(dst)) {
        console.info('Generating translation');

        translation = await translate(summary);
        fs.writeFileSync(dst, translation);
      } else {
        console.info('Translation found. Skipping.');
      }
    } catch (ex) {
      console.error(ex);
    }
  }
})();

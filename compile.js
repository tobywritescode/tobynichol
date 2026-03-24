const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, 'briefings');
const TEMPLATE_FILE = path.join(__dirname, 'assets', 'template.html');
const OUTPUT_DIR = path.join(__dirname, 'articles');
const INDEX_FILE = path.join(__dirname, 'articles.json');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
const articles = [];

const files = fs.readdirSync(SOURCE_DIR);

files.forEach(file => {
    if (!file.endsWith('.txt')) return;

    const filePath = path.join(SOURCE_DIR, file);
    const rawContent = fs.readFileSync(filePath, 'utf8');

    // Parse Frontmatter
    const [header, ...bodyParts] = rawContent.split('---');
    const body = bodyParts.join('---').trim();
    const metadata = {};

    header.split('\n').forEach(line => {
        const [key, ...val] = line.split(':');
        if (key && val.length) {
            metadata[key.trim()] = val.join(':').trim();
        }
    });

    // Generate output filename
    const fileName = file.replace('.txt', '.html');
    const outputPath = path.join(OUTPUT_DIR, fileName);

    // Inject into template
    let finalHtml = template;
    Object.keys(metadata).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        finalHtml = finalHtml.replace(regex, metadata[key]);
    });
    finalHtml = finalHtml.replace(/{{CONTENT}}/g, body);

    // Write file
    fs.writeFileSync(outputPath, finalHtml);
    console.log(`[EXECUTED] Generated: ${fileName}`);

    // Add to index
    articles.push({
        id: metadata.ID,
        title: metadata.TITLE,
        category: metadata.CATEGORY,
        path: `articles/${fileName}`
    });
});

// Write JSON index
fs.writeFileSync(INDEX_FILE, JSON.stringify(articles, null, 2));
console.log(`[SYSTEM] Articles index updated: articles.json`);

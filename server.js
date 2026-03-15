const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'store.db');

const db = new sqlite3.Database(dbPath);
const SIZE_KEYS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const FALLBACK_STOCK = SIZE_KEYS.reduce((acc, size) => {
  acc[size] = 0;
  return acc;
}, {});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function initDb() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        price REAL NOT NULL,
        imageUrl TEXT NOT NULL,
        sizes TEXT NOT NULL,
        stockBySize TEXT
      )`
    );

    ensureStockColumn(() => {
      db.get('SELECT COUNT(*) AS count FROM products', (err, row) => {
        if (err) {
          console.error('Failed to count products:', err.message);
          return;
        }
        if (row.count === 0) {
          const seed = [
            {
              title: 'Oversized Utility Hoodie',
              description: 'Heavy fleece, dropped shoulders, and extra length for a stacked fit.',
              price: 68.0,
              imageUrl: 'https://images.pexels.com/photos/1040945/pexels-photo-1040945.jpeg?auto=compress&cs=tinysrgb&w=800',
              stockBySize: { XS: 0, S: 2, M: 5, L: 1, XL: 3, XXL: 0 }
            },
            {
              title: 'Baggy Cargo Pants',
              description: 'Wide-leg cargos with adjustable cuffs and oversized pockets.',
              price: 84.0,
              imageUrl: 'https://images.pexels.com/photos/4210864/pexels-photo-4210864.jpeg?auto=compress&cs=tinysrgb&w=800',
              stockBySize: { XS: 1, S: 0, M: 4, L: 2, XL: 1, XXL: 0 }
            },
            {
              title: 'Graphic Street Tee',
              description: 'Boxy fit tee with bold back print and soft cotton jersey.',
              price: 38.0,
              imageUrl: 'https://images.pexels.com/photos/6347845/pexels-photo-6347845.jpeg?auto=compress&cs=tinysrgb&w=800',
              stockBySize: { XS: 0, S: 3, M: 4, L: 2, XL: 1, XXL: 0 }
            },
            {
              title: 'Puffer Vest Layer',
              description: 'Cropped puffer with matte finish and oversized collar.',
              price: 96.0,
              imageUrl: 'https://images.pexels.com/photos/4937220/pexels-photo-4937220.jpeg?auto=compress&cs=tinysrgb&w=800',
              stockBySize: { XS: 0, S: 1, M: 2, L: 1, XL: 0, XXL: 0 }
            }
          ];

          const stmt = db.prepare('INSERT INTO products (title, description, price, imageUrl, sizes, stockBySize) VALUES (?, ?, ?, ?, ?, ?)');
          seed.forEach(item => {
            const stock = normalizeStockBySize(item.stockBySize);
            const sizesString = sizesFromStock(stock).join(',');
            stmt.run(item.title, item.description, item.price, item.imageUrl, sizesString, JSON.stringify(stock));
          });
          stmt.finalize();
        }
      });

      migrateStockBySize();
      updateSeedImages();
    });
  });
}

function ensureStockColumn(callback) {
  db.all('PRAGMA table_info(products)', (err, columns) => {
    if (err) {
      console.error('Failed to read products schema:', err.message);
      callback();
      return;
    }
    const hasStockColumn = columns.some(col => col.name === 'stockBySize');
    if (!hasStockColumn) {
      db.run('ALTER TABLE products ADD COLUMN stockBySize TEXT', callback);
      return;
    }
    callback();
  });
}

function normalizeStockBySize(stockBySize) {
  const normalized = { ...FALLBACK_STOCK };
  if (stockBySize && typeof stockBySize === 'object') {
    SIZE_KEYS.forEach(size => {
      const raw = stockBySize[size];
      const value = Number.isFinite(raw) ? raw : parseInt(raw, 10);
      normalized[size] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    });
  }
  return normalized;
}

function sizesFromStock(stockBySize) {
  return SIZE_KEYS.filter(size => stockBySize[size] > 0);
}

function parseSizesToStock(sizes) {
  const stock = { ...FALLBACK_STOCK };
  const list = Array.isArray(sizes) ? sizes : String(sizes || '').split(',');
  list.filter(Boolean).forEach(size => {
    if (SIZE_KEYS.includes(size)) {
      stock[size] = 1;
    }
  });
  return stock;
}

function migrateStockBySize() {
  db.all('SELECT id, sizes, stockBySize FROM products', (err, rows) => {
    if (err) {
      console.error('Failed to migrate stock:', err.message);
      return;
    }
    rows.forEach(row => {
      if (row.stockBySize) return;
      const stock = row.sizes ? parseSizesToStock(row.sizes) : { ...FALLBACK_STOCK };
      const sizesString = sizesFromStock(stock).join(',');
      db.run('UPDATE products SET stockBySize = ?, sizes = ? WHERE id = ?', [
        JSON.stringify(stock),
        sizesString,
        row.id
      ]);
    });
  });
}

function updateSeedImages() {
  const replacements = {
    'Oversized Utility Hoodie': 'https://images.pexels.com/photos/1040945/pexels-photo-1040945.jpeg?auto=compress&cs=tinysrgb&w=800',
    'Baggy Cargo Pants': 'https://images.pexels.com/photos/4210864/pexels-photo-4210864.jpeg?auto=compress&cs=tinysrgb&w=800',
    'Graphic Street Tee': 'https://images.pexels.com/photos/6347845/pexels-photo-6347845.jpeg?auto=compress&cs=tinysrgb&w=800',
    'Puffer Vest Layer': 'https://images.pexels.com/photos/4937220/pexels-photo-4937220.jpeg?auto=compress&cs=tinysrgb&w=800'
  };
  Object.entries(replacements).forEach(([title, url]) => {
    db.run('UPDATE products SET imageUrl = ? WHERE title = ? AND imageUrl LIKE "%images.unsplash.com%"', [url, title]);
  });
}

function buildStockFromBody(stockBySize, sizes) {
  if (stockBySize && typeof stockBySize === 'object') {
    return normalizeStockBySize(stockBySize);
  }
  if (sizes) {
    return parseSizesToStock(sizes);
  }
  return null;
}

function validateStock(stockBySize) {
  if (!stockBySize || typeof stockBySize !== 'object') return false;
  return SIZE_KEYS.every(size => Number.isInteger(stockBySize[size]) && stockBySize[size] >= 0);
}

function normalizeRow(row) {
  let stock = row.stockBySize;
  if (typeof stock === 'string') {
    try {
      stock = JSON.parse(stock);
    } catch (e) {
      stock = null;
    }
  }
  if (!stock) {
    stock = row.sizes ? parseSizesToStock(row.sizes) : { ...FALLBACK_STOCK };
  }
  const fixedStock = normalizeStockBySize(stock);
  return {
    ...row,
    stockBySize: fixedStock,
    sizes: sizesFromStock(fixedStock).join(',')
  };
}

app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const normalized = rows.map(row => normalizeRow(row));
    res.json(normalized);
  });
});

app.get('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(normalizeRow(row));
  });
});

app.post('/api/products', (req, res) => {
  const { title, description, price, imageUrl, stockBySize, sizes } = req.body;
  const stock = buildStockFromBody(stockBySize, sizes);
  if (!title || !description || price === undefined || !imageUrl || !stock) {
    return res.status(400).json({ error: 'Missing fields.' });
  }
  const normalizedStock = normalizeStockBySize(stock);
  if (!validateStock(normalizedStock)) {
    return res.status(400).json({ error: 'Invalid stockBySize.' });
  }
  const sizesString = sizesFromStock(normalizedStock).join(',');
  const stmt = 'INSERT INTO products (title, description, price, imageUrl, sizes, stockBySize) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(stmt, [title, description, price, imageUrl, sizesString, JSON.stringify(normalizedStock)], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: this.lastID });
  });
});

app.put('/api/products/:id', (req, res) => {
  const { title, description, price, imageUrl, stockBySize, sizes } = req.body;
  const { id } = req.params;
  const stock = buildStockFromBody(stockBySize, sizes);
  if (!title || !description || price === undefined || !imageUrl || !stock) {
    return res.status(400).json({ error: 'Missing fields.' });
  }
  const normalizedStock = normalizeStockBySize(stock);
  if (!validateStock(normalizedStock)) {
    return res.status(400).json({ error: 'Invalid stockBySize.' });
  }
  const sizesString = sizesFromStock(normalizedStock).join(',');
  const stmt = 'UPDATE products SET title = ?, description = ?, price = ?, imageUrl = ?, sizes = ?, stockBySize = ? WHERE id = ?';
  db.run(stmt, [title, description, price, imageUrl, sizesString, JSON.stringify(normalizedStock), id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ updated: this.changes });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM products WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: this.changes });
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

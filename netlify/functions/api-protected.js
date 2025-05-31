const fs = require('fs');

// Proste rate limiting - trzyma dane w pamięci
let requestCounts = {};

// Ustawienia
const MAX_REQUESTS = 50;      // 50 zapytań
const TIME_WINDOW = 15 * 60 * 1000;  // 15 minut

function checkRateLimit(clientIP) {
  const now = Date.now();
  
  // Usuń stare wpisy (starsze niż 15 minut)
  Object.keys(requestCounts).forEach(ip => {
    if (now - requestCounts[ip].firstRequest > TIME_WINDOW) {
      delete requestCounts[ip];
    }
  });

  // Jeśli IP nie istnieje, stwórz nowy wpis
  if (!requestCounts[clientIP]) {
    requestCounts[clientIP] = {
      count: 1,
      firstRequest: now
    };
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  // Sprawdź czy przekroczył limit
  if (requestCounts[clientIP].count >= MAX_REQUESTS) {
    return { 
      allowed: false, 
      remaining: 0,
      resetTime: requestCounts[clientIP].firstRequest + TIME_WINDOW
    };
  }

  // Zwiększ licznik
  requestCounts[clientIP].count++;
  
  return { 
    allowed: true, 
    remaining: MAX_REQUESTS - requestCounts[clientIP].count 
  };
}

function getClientIP(event) {
  return event.headers['x-forwarded-for']?.split(',')[0] || 
         event.headers['x-real-ip'] || 
         'unknown';
}

// Skopiuj funkcje z oryginalnego API
function loadData(category, subcategory = null) {
  try {
    let filePath;
    
    if (subcategory) {
      filePath = `./netlify/data/${category}/${subcategory}.json`;
    } else {
      filePath = `./netlify/data/${category}/${category}.json`;
    }
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data;
  } catch (error) {
    console.error(`Error loading data:`, error.message);
    return null;
  }
}

function getItemData(data, category, item) {
  if (category === 'profiles') {
    return data.profiles?.[item.toUpperCase()];
  } else if (category === 'materials') {
    return data.grades?.[item.toUpperCase()];
  } else if (category === 'bolts') {
    return data.bolts?.[item.toUpperCase()];
  }
  return data[item.toUpperCase()];
}

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  // SPRAWDŹ RATE LIMIT
  const clientIP = getClientIP(event);
  const rateLimitCheck = checkRateLimit(clientIP);

  if (!rateLimitCheck.allowed) {
    const resetIn = Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000 / 60); // minuty
    
    return {
      statusCode: 429,
      headers: {
        ...headers,
        'X-RateLimit-Limit': MAX_REQUESTS.toString(),
        'X-RateLimit-Remaining': '0',
      },
      body: JSON.stringify({
        error: 'Too many requests',
        message: `Limit: ${MAX_REQUESTS} requests per 15 minutes`,
        resetInMinutes: resetIn,
        yourIP: clientIP
      })
    };
  }

  // RESZTA KODU - identyczna jak w oryginalnym API
  let segments = event.path.split('/').filter(Boolean);
  
  if (segments[0] === '.netlify' && segments[1] === 'functions' && segments[2] === 'api-protected') {
    segments = segments.slice(3);
  } else if (segments[0] === 'api-protected') {
    segments.shift();
  }

  if (segments.length < 2) {
    return {
      statusCode: 400,
      headers: {
        ...headers,
        'X-RateLimit-Limit': MAX_REQUESTS.toString(),
        'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
      },
      body: JSON.stringify({ 
        error: 'Invalid URL format',
        examples: ['/api-protected/profiles/hea/HEA120/tw'],
        rateLimit: `${rateLimitCheck.remaining} requests remaining`
      })
    };
  }

  const [category, subcategory, item, property] = segments;
  
  const data = loadData(category, subcategory);
  if (!data) {
    return {
      statusCode: 404,
      headers: {
        ...headers,
        'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
      },
      body: JSON.stringify({ 
        error: `Category '${category}' or subcategory '${subcategory}' not found`
      })
    };
  }

  const itemData = getItemData(data, category, item);
  
  if (!itemData) {
    return {
      statusCode: 404,
      headers: {
        ...headers,
        'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
      },
      body: JSON.stringify({ 
        error: `Item '${item}' not found`
      })
    };
  }

  if (!property) {
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
      },
      body: JSON.stringify({
        item: item.toUpperCase(),
        data: itemData,
        available_properties: Object.keys(itemData)
      })
    };
  }

  if (itemData[property] === undefined) {
    return {
      statusCode: 404,
      headers: {
        ...headers,
        'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
      },
      body: JSON.stringify({ 
        error: `Property '${property}' not found for ${item}`
      })
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'X-RateLimit-Remaining': rateLimitCheck.remaining.toString()
    },
    body: JSON.stringify({
      category: category,
      subcategory: subcategory,
      item: item.toUpperCase(),
      property: property,
      value: itemData[property],
      unit: data.units?.[property] || '',
      description: data.properties_description?.[property] || property,
      source: data.source || 'Unknown',
      requestsRemaining: rateLimitCheck.remaining
    })
  };
};
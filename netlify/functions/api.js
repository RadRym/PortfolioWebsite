const fs = require('fs');
const path = require('path');

// Cache dla lepszej wydajności
let dataCache = {};

function loadData(category, subcategory = null) {
  const cacheKey = subcategory ? `${category}/${subcategory}` : category;
  
  if (dataCache[cacheKey]) {
    return dataCache[cacheKey];
  }

  try {
    const filePath = subcategory 
      ? path.join(__dirname, '..', 'data', category, `${subcategory}.json`)
      : path.join(__dirname, '..', 'data', category, `${category}.json`);
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    dataCache[cacheKey] = data;
    return data;
  } catch (error) {
    console.error(`Error loading data for ${cacheKey}:`, error.message);
    return null;
  }
}

function getItemData(data, category, item) {
  // Różne struktury dla różnych kategorii
  if (category === 'profiles') {
    return data.profiles?.[item.toUpperCase()];
  } else if (category === 'materials') {
    return data.grades?.[item.toUpperCase()];
  } else if (category === 'bolts') {
    return data.bolts?.[item.toUpperCase()];
  }
  return data[item.toUpperCase()];
}

function getPropertyDescription(data, property) {
  return data.properties_description?.[property] || property;
}

function getPropertyUnit(data, property) {
  return data.units?.[property] || '';
}

exports.handler = async (event, context) => {
  // Ustaw CORS headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: headers,
      body: ''
    };
  }

  // Parse URL - expected format: /api/category/subcategory/item/property
  // Examples: 
  // /api/profiles/hea/HEA120/tw
  // /api/materials/steel/S235/fy
  // /api/bolts/din931/M12/d
  
  const segments = event.path.split('/').filter(Boolean);
  
  // Remove 'api' from segments if present
  if (segments[0] === 'api') {
    segments.shift();
  }

  if (segments.length < 2) {
    return {
      statusCode: 400,
      headers: headers,
      body: JSON.stringify({ 
        error: 'Invalid URL format',
        expected: '/api/category/subcategory/item/property',
        examples: [
          '/api/profiles/hea/HEA120/tw',
          '/api/materials/steel/S235/fy',
          '/api/bolts/din931/M12/d'
        ]
      })
    };
  }

  const [category, subcategory, item, property] = segments;
  
  // Załaduj dane
  const data = loadData(category, subcategory);
  if (!data) {
    return {
      statusCode: 404,
      headers: headers,
      body: JSON.stringify({ 
        error: `Category '${category}' or subcategory '${subcategory}' not found`,
        available_categories: ['profiles', 'materials', 'bolts']
      })
    };
  }

  // Jeśli nie ma item, zwróć informacje o kategorii
  if (!item) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        category: category,
        subcategory: subcategory,
        description: data.description,
        available_items: Object.keys(getItemContainer(data, category)),
        data_structure: data
      })
    };
  }

  // Znajdź dane dla konkretnego elementu
  const itemData = getItemData(data, category, item);
  
  if (!itemData) {
    const availableItems = Object.keys(getItemContainer(data, category));
    return {
      statusCode: 404,
      headers: headers,
      body: JSON.stringify({ 
        error: `Item '${item}' not found in ${category}/${subcategory}`,
        available_items: availableItems.slice(0, 10), // Pokaż pierwsze 10
        total_available: availableItems.length
      })
    };
  }

  // Jeśli nie ma property, zwróć cały obiekt
  if (!property) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        category: category,
        subcategory: subcategory,
        item: item.toUpperCase(),
        description: data.description,
        data: itemData,
        available_properties: Object.keys(itemData),
        properties_description: data.properties_description,
        units: data.units
      })
    };
  }

  // Zwróć konkretną właściwość
  if (itemData[property] === undefined) {
    return {
      statusCode: 404,
      headers: headers,
      body: JSON.stringify({ 
        error: `Property '${property}' not found for ${item}`,
        available_properties: Object.keys(itemData)
      })
    };
  }

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({
      category: category,
      subcategory: subcategory,
      item: item.toUpperCase(),
      property: property,
      value: itemData[property],
      unit: getPropertyUnit(data, property),
      description: getPropertyDescription(data, property),
      source: data.source || 'Unknown'
    })
  };
};

// Helper function to get the container with items
function getItemContainer(data, category) {
  if (category === 'profiles') {
    return data.profiles || {};
  } else if (category === 'materials') {
    return data.grades || {};
  } else if (category === 'bolts') {
    return data.bolts || {};
  }
  return {};
}
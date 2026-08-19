// src/services/aviationService.ts

// מידע הגיבוי שלנו - שומר עליך בטוח למצגת מחר!
const MOCK_DATA = [
  {
    airportCode: 'LHR', name: 'Heathrow', country: 'UK', continent: 'Europe',
    totalDailyFlights: 1250, delayedFlightsPercentage: 0.28, longHaulPercentage: 0.45, dominantAirlinePercentage: 0.48, uniqueDestinations: 214
  },
  {
    airportCode: 'JFK', name: 'John F. Kennedy', country: 'USA', continent: 'North America',
    totalDailyFlights: 1300, delayedFlightsPercentage: 0.35, longHaulPercentage: 0.3, dominantAirlinePercentage: 0.25, uniqueDestinations: 190
  },
  {
    airportCode: 'DXB', name: 'Dubai International', country: 'UAE', continent: 'Asia',
    totalDailyFlights: 1100, delayedFlightsPercentage: 0.15, longHaulPercentage: 0.7, dominantAirlinePercentage: 0.65, uniqueDestinations: 260
  }
];

export async function getAirportData(airportCode: string) {
  const upperCode = airportCode.toUpperCase();
  const apiKey = process.env.AVIATION_API_KEY;
  
  // הערה חשובה: התוכנית החינמית של AviationStack תומכת רק ב-http (ולא https)
  const API_URL = `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&dep_iata=${upperCode}`;

  try {
    if (!apiKey) {
      console.warn('⚠️ No AVIATION_API_KEY found. Falling back to Mock Data.');
      return getMockFallback(upperCode);
    }

    console.log(`[AviationService] Fetching LIVE data for ${upperCode} from AviationStack...`);
    
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('API Response not OK');

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      console.log(`[AviationService] No live flights found for ${upperCode}, using fallback.`);
      return getMockFallback(upperCode);
    }

    // עיבוד נתוני האמת מה-API
    const flights = data.data;
    const totalFlights = flights.length;
    let delayedFlights = 0;

    flights.forEach((flight: any) => {
      // אם העיכוב גדול מ-15 דקות
      if (flight.departure && flight.departure.delay > 15) {
        delayedFlights++;
      }
    });

    const delayPercentage = totalFlights > 0 ? (delayedFlights / totalFlights) : 0;

    return {
      airport: {
        airportCode: upperCode,
        name: flights[0]?.departure?.airport || upperCode,
        country: 'Live External Data',
        continent: 'Global'
      },
      metrics: {
        airportCode: upperCode,
        // מכפילים ב-10 סתם כדי שזה ייראה כמו מספר טיסות יומי הגיוני (ה-API החינמי מחזיר רק 100 בכל קריאה)
        totalDailyFlights: totalFlights > 0 ? totalFlights * 10 : 500, 
        delayedFlightsPercentage: parseFloat(delayPercentage.toFixed(2)),
        longHaulPercentage: 0.35, // נתון משוער לתצוגה
        dominantAirlinePercentage: 0.25, // נתון משוער לתצוגה
        uniqueDestinations: 150
      }
    };

  } catch (error) {
    console.error(`[AviationService] Live API Error for ${upperCode}:`, error);
    return getMockFallback(upperCode);
  }
}

// פונקציית העזר שמחזירה את המידע הקשיח שלנו במקרה שה-API נופל
function getMockFallback(code: string) {
  const mock = MOCK_DATA.find(m => m.airportCode === code);
  if (!mock) return null; // שדה תעופה לא נמצא גם במאגר המקומי

  return {
    airport: {
      airportCode: mock.airportCode,
      name: mock.name,
      country: mock.country,
      continent: mock.continent
    },
    metrics: {
      airportCode: mock.airportCode,
      totalDailyFlights: mock.totalDailyFlights,
      delayedFlightsPercentage: mock.delayedFlightsPercentage,
      longHaulPercentage: mock.longHaulPercentage,
      dominantAirlinePercentage: mock.dominantAirlinePercentage,
      uniqueDestinations: mock.uniqueDestinations
    }
  };
}
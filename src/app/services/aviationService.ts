// src/services/aviationService.ts

import { Airport, AirportMetrics } from '../types';

// Fallback Mock Data: Ensures the application remains functional for demos/interviews 
// even if the external aviation API is down or rate-limited.
const MOCK_AIRPORTS: Airport[] = [
  { airportCode: 'LHR', name: 'Heathrow', country: 'UK', continent: 'Europe' },
  { airportCode: 'DXB', name: 'Dubai International', country: 'UAE', continent: 'Asia' },
  { airportCode: 'JFK', name: 'John F. Kennedy', country: 'USA', continent: 'North America' }
];

const MOCK_METRICS: AirportMetrics[] = [
  {
    airportCode: 'LHR',
    totalDailyFlights: 1250,
    delayedFlightsPercentage: 0.28, // 28% delays - indicates infrastructure strain
    longHaulPercentage: 0.45,
    dominantAirlinePercentage: 0.48, // British Airways - moderate dependency risk
    uniqueDestinations: 214,
  },
  {
    airportCode: 'DXB',
    totalDailyFlights: 1100,
    delayedFlightsPercentage: 0.15,
    longHaulPercentage: 0.70, // High long-haul volume - strong network quality
    dominantAirlinePercentage: 0.65, // Emirates - high dependency risk
    uniqueDestinations: 260,
  },
  {
    airportCode: 'JFK',
    totalDailyFlights: 1300,
    delayedFlightsPercentage: 0.35, // Heavy infrastructure congestion
    longHaulPercentage: 0.30,
    dominantAirlinePercentage: 0.25, // Healthy competition - low dependency risk
    uniqueDestinations: 190,
  }
];

export class AviationService {
  /**
   * Fetches real-time or historical flight data for a specific airport.
   * Currently uses mock data with simulated network latency for reliable demo purposes.
   * 
   * @param airportCode The 3-letter IATA code (e.g., 'LHR')
   * @returns The combined airport details and calculated metrics, or null if not found.
   */
  static async fetchAirportData(airportCode: string): Promise<{ airport: Airport; metrics: AirportMetrics } | null> {
    console.log(`[AviationService] Fetching data for ${airportCode}...`);
    
    // Simulate network latency (500ms)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const code = airportCode.toUpperCase();
    const airport = MOCK_AIRPORTS.find((a) => a.airportCode === code);
    const metrics = MOCK_METRICS.find((m) => m.airportCode === code);

    if (!airport || !metrics) {
      console.warn(`[AviationService] Airport ${code} not found in database.`);
      return null;
    }

    return { airport, metrics };
  }

  /**
   * Concurrently fetches data for multiple airports to optimize performance.
   * 
   * @param airportCodes Array of 3-letter IATA codes
   * @returns Array of successful data fetches (filters out nulls)
   */
  static async fetchMultipleAirports(airportCodes: string[]) {
    // Utilize Promise.all for concurrent network requests
    const results = await Promise.all(
      airportCodes.map(code => this.fetchAirportData(code))
    );
    
    // Filter out any airports that were not found in the database
    return results.filter((result): result is { airport: Airport; metrics: AirportMetrics } => result !== null);
  }
}
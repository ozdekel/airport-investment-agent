// src/app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import { AviationService } from '@/services/aviationService';
import { ScoringEngine } from '@/services/scoringEngine';
import { OpenRouterService } from '@/services/openRouterService';
import { LLMGuardrailsService } from '@/services/guardrailsService';
import { InvestmentScore } from '@/types';

/**
 * Simple helper function to extract IATA codes from the user's text.
 * In a real production app, this could be done by an NLP model or a specialized API,
 * but for this demo, we use a straightforward keyword extraction.
 */
function extractAirportCodes(text: string): string[] {
  const knownCodes = ['LHR', 'DXB', 'JFK'];
  const textUpper = text.toUpperCase();
  return knownCodes.filter(code => textUpper.includes(code));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userQuery, customWeights } = body;

    if (!userQuery) {
      return NextResponse.json({ error: 'User query is required.' }, { status: 400 });
    }

    console.log(`[Orchestrator] Received query: "${userQuery}"`);

    // 1. Entity Extraction (Simulated)
    // We check which airports the user is asking about.
    const codesToAnalyze = extractAirportCodes(userQuery);
    if (codesToAnalyze.length === 0) {
      return NextResponse.json({ 
        aiResponse: "I couldn't identify any supported airport codes in your query. Currently, I have deterministic data for LHR, DXB, and JFK. Which one would you like to explore?",
        analyzedData: []
      });
    }

    // 2. Fetch Data (AviationService)
    const rawData = await AviationService.fetchMultipleAirports(codesToAnalyze);

    // 3. Calculate Deterministic Scores (ScoringEngine)
    const analyzedAirports: InvestmentScore[] = rawData.map((data : any) =>
      ScoringEngine.calculateScore(data.airport, data.metrics, customWeights)
    );

    // 4. Generate AI Insights (OpenRouterService)
    const aiResponse = await OpenRouterService.generateInsights({
      userQuery,
      analyzedAirports
    });

    // 5. Post-processing Validation (LLM Guardrails)
    const isSafe = LLMGuardrailsService.isResponseSafe(aiResponse, analyzedAirports);
    
    let finalAiResponse = aiResponse;
    if (!isSafe) {
       console.warn('[Orchestrator] Guardrails blocked the LLM response due to hallucination.');
       finalAiResponse = "Security Alert: The AI generated a response containing metrics that do not match our deterministic calculations. To prevent misinformation, the text response has been blocked. Please rely solely on the raw data table provided below.";
    }

    // 6. Return the structured payload to the frontend
    return NextResponse.json({
      aiResponse: finalAiResponse,
      analyzedData: analyzedAirports
    });

  } catch (error) {
    console.error('[Orchestrator] Fatal error:', error);
    return NextResponse.json({ error: 'Internal server error processing the request.' }, { status: 500 });
  }
}
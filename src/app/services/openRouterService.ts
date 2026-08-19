// src/services/openRouterService.ts

import { AgentContext } from '@/types';

export class OpenRouterService {
  private static readonly API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  
  /**
   * Generates a natural language response from the LLM based on our deterministic data.
   * Enforces strict boundaries using a System Prompt and low temperature.
   * 
   * @param context The exact data (scores and query) to feed the AI
   * @returns The generated string response from the AI
   */
  static async generateInsights(context: AgentContext): Promise<string> {
    console.log('[OpenRouterService] Generating insights via LLM...');

    // The "System Prompt" is our main defense against hallucinations.
    // It defines the AI's persona and strictly limits its behavior.
    const systemPrompt = `You are a highly professional aviation investment analyst AI.
Your ONLY job is to explain the provided deterministic investment scores to the user in a clear, business-oriented manner.
CRITICAL RULES:
1. Do NOT invent, calculate, or estimate any financial or operational numbers. 
2. Ground your entire response ONLY on the provided JSON data context.
3. If the user asks general questions outside the domain of aviation infrastructure investment, politely explain your specific purpose and decline to answer.
4. Keep the tone analytical, concise, and objective.`;

    // The user prompt combines what they asked with the hard data we calculated
    const userPrompt = `User Query: "${context.userQuery}"\n\nDeterministic Data Context:\n${JSON.stringify(context.analyzedAirports, null, 2)}`;

    try {
      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          // Required headers for OpenRouter rankings
          'HTTP-Referer': 'http://localhost:3000', 
          'X-Title': 'Airport Investment Agent'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-pro', // Using Gemini via OpenRouter
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1 // Extremely low temperature to ensure factual, deterministic-like output
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
      
    } catch (error) {
      console.error('[OpenRouterService] Error generating insights:', error);
      // Fallback response if the LLM call fails
      return "I'm sorry, but I am currently unable to connect to the AI analysis engine. Please rely on the raw deterministic scores provided on your screen.";
    }
  }
}
// src/services/scoringEngine.ts

import { Airport, AirportMetrics, InvestmentScore, ScoringWeights } from '@/types';

export class ScoringEngine {
  // Default weights representing the baseline investment thesis
  private static readonly DEFAULT_WEIGHTS: ScoringWeights = {
    infrastructurePressure: 0.40,
    revenueQuality: 0.35,
    networkGravity: 0.25,
  };

  /**
   * Calculates the final investment score based on proxy metrics.
   * This is a deterministic, rule-based engine ensuring zero hallucinations in the math.
   * 
   * @param airport The base airport entity
   * @param metrics The raw and calculated proxy metrics
   * @param customWeights Optional HITL (Human-In-The-Loop) weights to override defaults
   * @returns The structured final investment score
   */
  static calculateScore(
    airport: Airport, 
    metrics: AirportMetrics, 
    customWeights?: ScoringWeights
  ): InvestmentScore {
    const weights = customWeights || this.DEFAULT_WEIGHTS;

    // 1. Infrastructure Score (0-100)
    // Higher delay percentage indicates severe congestion (need for investment/expansion).
    // Cap at 50% delay for maximum score.
    const delayFactor = Math.min(metrics.delayedFlightsPercentage / 0.5, 1);
    const infrastructureScore = Math.round(delayFactor * 100);

    // 2. Revenue Quality Score (0-100)
    // Lower dominance by a single airline means better revenue diversification (lower risk).
    // If a single airline has > 80%, score drops significantly.
    const dominanceFactor = Math.max(1 - (metrics.dominantAirlinePercentage / 0.8), 0);
    const revenueScore = Math.round(dominanceFactor * 100);

    // 3. Network Gravity Score (0-100)
    // Combination of long-haul percentage and unique destinations.
    const longHaulScore = Math.min(metrics.longHaulPercentage / 0.6, 1) * 50; 
    const destinationsScore = Math.min(metrics.uniqueDestinations / 300, 1) * 50;
    const networkScore = Math.round(longHaulScore + destinationsScore);

    // Calculate final weighted score
    const finalScore = Math.round(
      (infrastructureScore * weights.infrastructurePressure) +
      (revenueScore * weights.revenueQuality) +
      (networkScore * weights.networkGravity)
    );

    return {
      airport,
      metrics,
      finalScore,
      scoreBreakdown: {
        infrastructureScore,
        revenueScore,
        networkScore
      }
    };
  }
}
import { AlgorithmConfig } from '../types';

export const algorithms: AlgorithmConfig[] = [
  {
    type: 'chawathe',
    name: 'Chawathe et al. Algorithm',
    description:
      'Computes an edit script between two ordered labeled trees using a top-down matching phase followed by a bottom-up edit script generation. Produces a minimum-cost sequence of insert, delete, update, and move operations.',
    timeComplexity: 'O(n × m × max(depth₁, depth₂))',
    spaceComplexity: 'O(n × m)',
    steps: [
      'Parse infobox documents into ordered labeled trees',
      'Compute matching between tree nodes (top-down)',
      'Align children of matched nodes',
      'Generate edit script (insert, delete, update, move)',
      'Compute total edit distance and similarity',
      'Build diff output in XML/JSON format',
    ],
  },
  {
    type: 'nierman-chagathe',
    name: 'Nierman & Jagadish Algorithm',
    description:
      'A tree edit distance algorithm specifically designed for XML documents. Uses dynamic programming with a recursive formulation to compute the minimum cost of transforming one tree into another using insert, delete, and relabel operations.',
    timeComplexity: 'O(n² × m²)',
    spaceComplexity: 'O(n × m)',
    steps: [
      'Parse infobox documents into ordered labeled trees',
      'Initialize TED matrix with base cases',
      'Fill matrix using recursive subproblem decomposition',
      'Compute forest distances for subtree comparisons',
      'Backtrack through matrix to extract edit script',
      'Compute total edit distance and similarity',
      'Build diff output in XML/JSON format',
    ],
  },
];

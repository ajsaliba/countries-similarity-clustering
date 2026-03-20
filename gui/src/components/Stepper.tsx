import React from 'react';
import { Check, Globe, BarChart3, Map, TreePine, Cpu, FileOutput, Clock, Database, FolderOpen } from 'lucide-react';

interface StepperProps {
  currentPhase: number;
  totalPhases: number;
  onGoToPhase: (phase: number) => void;
}

const phaseInfo = [
  { icon: Globe,       label: 'Select Countries' },
  { icon: BarChart3,   label: 'Select Metrics' },
  { icon: Map,         label: 'Map & Algorithm' },
  { icon: FolderOpen,  label: 'Data Source' },
  { icon: Database,    label: 'Data Collection' },
  { icon: TreePine,    label: 'Tree Building' },
  { icon: Cpu,         label: 'Algorithm Execution' },
  { icon: FileOutput,  label: 'Results' },
  { icon: Clock,       label: 'Summary' },
];

export const Stepper: React.FC<StepperProps> = ({ currentPhase, totalPhases, onGoToPhase }) => {
  return (
    <div className="w-full px-4 py-3">
      <div className="flex items-center justify-between max-w-5xl mx-auto">
        {phaseInfo.slice(0, totalPhases).map((phase, index) => {
          const Icon = phase.icon;
          const isCompleted = index < currentPhase;
          const isCurrent = index === currentPhase;
          const isClickable = index <= currentPhase;

          return (
            <React.Fragment key={index}>
              <button
                onClick={() => isClickable && onGoToPhase(index)}
                disabled={!isClickable}
                className={`flex flex-col items-center gap-1 group relative ${
                  isClickable ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
                title={phase.label}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isCompleted
                      ? 'bg-accent-600 text-white'
                      : isCurrent
                      ? 'bg-primary-600 text-white ring-2 ring-primary-400 ring-offset-2 ring-offset-gray-950'
                      : 'bg-gray-800 text-gray-500 border border-gray-700'
                  }`}
                >
                  {isCompleted ? <Check size={18} /> : <Icon size={18} />}
                </div>
                <span
                  className={`text-[10px] font-medium whitespace-nowrap ${
                    isCurrent ? 'text-primary-400' : isCompleted ? 'text-accent-400' : 'text-gray-600'
                  }`}
                >
                  {phase.label}
                </span>
              </button>
              {index < totalPhases - 1 && (
                <div className="flex-1 h-px mx-1 mt-[-16px]">
                  <div
                    className={`h-full transition-colors duration-300 ${
                      index < currentPhase ? 'bg-accent-600' : 'bg-gray-800'
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

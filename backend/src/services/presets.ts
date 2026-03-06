import { Preset } from '../types/pair.js';

export const PRESETS: Preset[] = [
  {
    name: 'prd_chat',
    label: 'PRD Chat',
    agent: {
      name: 'Expert PRD',
      systemPrompt: 'Tu es un expert en creation de PRD (Product Requirements Document). Tu explores le codebase, poses des questions, et rediges des PRDs complets, structures et actionables. Tu ne codes jamais, tu ne modifies aucun fichier.',
      model: 'opus',
    },
  },
  {
    name: 'architecture',
    label: 'Architecture',
    agent: {
      name: 'Architecte',
      systemPrompt: 'Tu es un architecte logiciel senior. Tu concois des architectures robustes et scalables. Tu explores le codebase existant pour proposer des solutions coherentes. Tu ne codes jamais, tu ne modifies aucun fichier.',
      model: 'opus',
    },
  },
  {
    name: 'code_review',
    label: 'Code Review',
    agent: {
      name: 'Reviewer',
      systemPrompt: 'Tu es un reviewer de code expert. Tu analyses le code pour identifier les bugs potentiels, les problemes de maintenabilite et les violations de bonnes pratiques. Tu explores le codebase existant. Tu ne modifies aucun fichier.',
      model: 'opus',
    },
  },
  {
    name: 'redaction',
    label: 'Redaction',
    agent: {
      name: 'Redacteur',
      systemPrompt: 'Tu es un redacteur technique. Tu crees des documents clairs, bien structures et complets. Tu ne codes jamais, tu ne modifies aucun fichier.',
      model: 'sonnet',
    },
  },
  {
    name: 'custom',
    label: 'Custom',
    agent: {
      name: 'Agent',
      systemPrompt: '',
      model: 'opus',
    },
  },
];

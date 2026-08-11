import type { ScmProvider } from './types';
import type { TitanConfig } from '../../titan-config';
import { AzureDevOpsProvider } from './azure-devops';
import { GitHubProvider } from './github';

export type { ScmProvider } from './types';

/** Pick the SCM provider named by `config.platforms.scm.kind`. Defaults to
 *  Azure DevOps for backward compatibility with the pre-Titan behaviour if
 *  the field is missing (fail open, not fail closed — a missing config key
 *  should not break the wizard). */
export function getScmProvider(config: TitanConfig): ScmProvider {
  const kind = config.platforms.scm.kind;
  if (kind === 'github') return new GitHubProvider(config.platforms.scm, config.repos);
  return new AzureDevOpsProvider(config.platforms.scm, config.repos);
}

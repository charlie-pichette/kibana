/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AppMountParameters, CoreStart } from 'kibana/public';
import { createContext } from 'react';
import type { ObservabilityRuleTypeRegistry } from '../../../../observability/public';
import { ConfigSchema } from '../..';
import { ApmPluginSetupDeps } from '../../plugin';
import { MapsStartApi } from '../../../../maps/public';

export interface ApmPluginContextValue {
  appMountParameters: AppMountParameters;
  config: ConfigSchema;
  core: CoreStart;
  plugins: ApmPluginSetupDeps & { maps?: MapsStartApi };
  observabilityRuleTypeRegistry: ObservabilityRuleTypeRegistry;
}

export const ApmPluginContext = createContext({} as ApmPluginContextValue);

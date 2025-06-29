/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { FormEvent, useEffect, useState } from 'react';
import {
  EuiText,
  EuiButton,
  EuiSwitch,
  EuiSpacer,
  EuiFilterButton,
  EuiPopover,
  EuiPopoverFooter,
  EuiPopoverTitle,
  EuiSelectable,
  EuiSelectableOption,
  EuiLoadingSpinner,
  useEuiTheme,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { isEqual, map } from 'lodash';
import styled from '@emotion/styled';
import { FieldValueSelectionProps, ListItem } from './types';
const Counter = styled.div`
  border-radius: ${({ theme }) => theme.euiTheme.border.radius.medium};
  background: ${({ theme }) => theme.euiTheme.colors.lightShade};
  padding: 0 ${({ theme }) => theme.euiTheme.size.xs};
`;

const formatOptions = (
  values?: ListItem[],
  selectedValue?: string[],
  excludedValues?: string[],
  showCount?: boolean
): EuiSelectableOption[] => {
  const uniqueValues: Record<string, number> = {};

  values?.forEach(({ label, count }) => {
    uniqueValues[label] = count;
  });

  return Object.entries(uniqueValues).map(([label, count]) => ({
    label,
    append: showCount ? (
      <Counter>
        <EuiText size="xs">{count}</EuiText>
      </Counter>
    ) : null,
    ...(selectedValue?.includes(label) ? { checked: 'on' } : {}),
    ...(excludedValues?.includes(label) ? { checked: 'off' } : {}),
  }));
};

export function FieldValueSelection({
  fullWidth,
  label,
  loading,
  query,
  setQuery,
  button,
  width,
  forceOpen,
  setForceOpen,
  anchorPosition,
  singleSelection,
  asFilterButton,
  showCount = true,
  values = [],
  selectedValue,
  excludedValue,
  allowExclusions = true,
  compressed = true,
  useLogicalAND,
  showLogicalConditionSwitch = false,
  onChange: onSelectionChange,
}: FieldValueSelectionProps) {
  const { euiTheme } = useEuiTheme();

  const [options, setOptions] = useState<EuiSelectableOption[]>(() =>
    formatOptions(values, selectedValue, excludedValue, showCount)
  );

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const [isLogicalAND, setIsLogicalAND] = useState(useLogicalAND);

  useEffect(() => {
    setIsLogicalAND(useLogicalAND);
  }, [useLogicalAND]);

  useEffect(() => {
    setOptions(formatOptions(values, selectedValue, excludedValue, showCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), JSON.stringify(selectedValue), showCount, excludedValue]);

  const onButtonClick = () => {
    setIsPopoverOpen(!isPopoverOpen);
  };

  const closePopover = () => {
    setIsPopoverOpen(false);
    setForceOpen?.(false);
  };

  const onChange = (optionsN: EuiSelectableOption[]) => {
    setOptions(optionsN);
  };

  const onValueChange = (evt: FormEvent<HTMLInputElement>) => {
    setQuery((evt.target as HTMLInputElement).value);
  };

  const anchorButton = (
    <EuiButton
      style={width ? { width } : {}}
      size="m"
      color="text"
      iconType="arrowDown"
      iconSide="right"
      onClick={onButtonClick}
      data-test-subj={'fieldValueSelectionBtn'}
      fullWidth={fullWidth}
    >
      {label}
    </EuiButton>
  );

  const numOfFilters = (selectedValue || []).length + (excludedValue || []).length;

  const filterButton = (
    <EuiFilterButton
      aria-label={i18n.translate('xpack.observabilityShared.fieldValueSelection.label', {
        defaultMessage: 'expands filter group for {label} filter',
        values: { label },
      })}
      isSelected={isPopoverOpen || forceOpen}
      hasActiveFilters={numOfFilters > 0}
      iconType="arrowDown"
      numActiveFilters={numOfFilters}
      numFilters={options.length}
      onClick={onButtonClick}
    >
      {label}
    </EuiFilterButton>
  );

  const applyDisabled = () => {
    const currSelected = (options ?? [])
      .filter((opt) => opt?.checked === 'on')
      .map(({ label: labelN }) => labelN);

    const currExcluded = (options ?? [])
      .filter((opt) => opt?.checked === 'off')
      .map(({ label: labelN }) => labelN);

    const hasFilterSelected = (selectedValue ?? []).length > 0 || (excludedValue ?? []).length > 0;

    return (
      isEqual(selectedValue ?? [], currSelected) &&
      isEqual(excludedValue ?? [], currExcluded) &&
      !(isLogicalAND !== useLogicalAND && hasFilterSelected)
    );
  };

  return (
    <Wrapper>
      <EuiPopover
        id="popover"
        panelPaddingSize="none"
        button={button || (asFilterButton ? filterButton : anchorButton)}
        isOpen={isPopoverOpen || forceOpen}
        closePopover={closePopover}
        anchorPosition={anchorPosition}
        display="block"
      >
        <EuiSelectable
          searchable
          singleSelection={singleSelection}
          searchProps={{
            placeholder: i18n.translate(
              'xpack.observabilityShared.fieldValueSelection.placeholder',
              {
                defaultMessage: 'Filter {label}',
                values: { label },
              }
            ),
            compressed,
            onInput: onValueChange,
            'data-test-subj': 'suggestionInputField',
          }}
          listProps={{
            onFocusBadge: false,
          }}
          options={options}
          onChange={onChange}
          allowExclusions={allowExclusions}
          isLoading={loading && !query && options.length === 0}
        >
          {(list, search) => (
            <div style={{ width: 240 }}>
              <EuiPopoverTitle paddingSize="s">{search}</EuiPopoverTitle>
              {list}
              {loading && query && (
                <EuiText className="eui-textCenter" color="subdued">
                  {i18n.translate('xpack.observabilityShared.fieldValueSelection.loading', {
                    defaultMessage: 'Loading',
                  })}{' '}
                  <EuiLoadingSpinner size="m" />
                </EuiText>
              )}
              <EuiPopoverFooter paddingSize="s">
                {showLogicalConditionSwitch && (
                  <>
                    <EuiSpacer size="xs" />
                    <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <EuiSwitch
                        css={{
                          flexDirection: 'row-reverse',
                          gap: euiTheme.size.s,
                          color: euiTheme.colors.textSubdued,
                        }}
                        label={i18n.translate(
                          'xpack.observabilityShared.fieldValueSelection.logicalAnd',
                          {
                            defaultMessage: 'Use logical AND',
                          }
                        )}
                        data-test-subj="tagsLogicalOperatorSwitch"
                        checked={Boolean(isLogicalAND)}
                        compressed={true}
                        onChange={(e) => {
                          setIsLogicalAND(e.target.checked);
                        }}
                      />
                    </div>
                    <EuiSpacer size="m" />
                  </>
                )}

                <EuiButton
                  data-test-subj="o11yFieldValueSelectionApplyButton"
                  aria-label={i18n.translate(
                    'xpack.observabilityShared.fieldValueSelection.apply.label',
                    {
                      defaultMessage: 'Apply the selected filters for {label}',
                      values: { label },
                    }
                  )}
                  fill
                  fullWidth
                  size="s"
                  isDisabled={applyDisabled()}
                  onClick={() => {
                    const selectedValuesN = options.filter((opt) => opt?.checked === 'on');
                    const excludedValuesN = options.filter((opt) => opt?.checked === 'off');

                    if (showLogicalConditionSwitch) {
                      onSelectionChange(
                        map(selectedValuesN, 'label'),
                        map(excludedValuesN, 'label'),
                        isLogicalAND
                      );
                    } else {
                      onSelectionChange(
                        map(selectedValuesN, 'label'),
                        map(excludedValuesN, 'label')
                      );
                    }

                    setIsPopoverOpen(false);
                    setForceOpen?.(false);
                  }}
                >
                  {i18n.translate('xpack.observabilityShared.fieldValueSelection.apply', {
                    defaultMessage: 'Apply',
                  })}
                </EuiButton>
              </EuiPopoverFooter>
            </div>
          )}
        </EuiSelectable>
      </EuiPopover>
    </Wrapper>
  );
}

// eslint-disable-next-line import/no-default-export
export default FieldValueSelection;

const Wrapper = styled.div`
  &&& {
    .euiButton {
      width: 100%;
    }
  }
`;

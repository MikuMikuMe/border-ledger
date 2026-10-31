import {BudgetScreen} from './BudgetScreen';
import React, {useEffect, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import type {ShellDestination} from '@/features/auth/authModel';
import {FinanceScreen} from './FinanceScreen';
import {DetailsScreen} from './DetailsScreen';
import {ToolsScreen} from './ToolsScreen';
import {ShellNavigation, type Page} from './ShellNavigation';

type Props = {dark: boolean; initialDestination: ShellDestination; onAbout(): void; onSignOut(): Promise<void>};
function DestinationPanel({dark, selected, onOpen}: {dark: boolean; selected: Page; onOpen(page: Page): void}) {
  const [recurringId, setRecurringId] = useState<string | null>(null);
  useEffect(() => setRecurringId(null), [selected]);
  if (selected === 'budget') return <BudgetScreen dark={dark}/>;
  if (selected === 'overview' || selected === 'activity') return <FinanceScreen dark={dark} destination={selected}/>;
  if (selected === 'recurring') return <>
    <FinanceScreen dark={dark} destination="recurring" onOpenRecurring={setRecurringId}/>
    <DetailsScreen dark={dark} destination="recurring" recurringId={recurringId} onCloseRecurring={() => setRecurringId(null)}/>
  </>;
  if (selected === 'review' || selected === 'accounts') return <DetailsScreen dark={dark} destination={selected}/>;
  if (selected === 'more') return null;
  return <ToolsScreen dark={dark} destination={selected} onCapture={() => onOpen('capture')}/>;
}
export function AppShellScreen(props: Props) {
  const isFocused = useIsFocused();
  return <ShellNavigation {...props} isFocused={isFocused} renderPage={(page, onOpen) => <DestinationPanel dark={props.dark} selected={page} onOpen={onOpen}/>}/>;
}

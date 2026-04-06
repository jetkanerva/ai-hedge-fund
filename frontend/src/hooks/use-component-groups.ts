import { ComponentGroup } from '@/data/sidebar-components';
import { useEffect, useMemo, useState } from 'react';

export function useComponentGroups(componentGroups: ComponentGroup[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeItem, setActiveItem] = useState<string | null>('Chat Input');
  // Start with all groups expanded by default if we have groups
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Initialize openGroups with all group names once componentGroups are loaded
  useEffect(() => {
    if (componentGroups.length > 0 && openGroups.length === 0 && !searchQuery) {
      setOpenGroups(componentGroups.map(g => g.name));
    }
  }, [componentGroups]);

  // Filter groups and items based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return componentGroups;

    return componentGroups.map(group => {
      // Filter items within the group
      const filteredItems = group.items.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

      // Return group with filtered items
      return {
        ...group,
        items: filteredItems
      };
    }).filter(group => group.items.length > 0); // Only include groups with matching items
  }, [componentGroups, searchQuery]);

  // Handle search query changes
  useEffect(() => {
    if (searchQuery) {
      setIsSearching(true);
      // Open all groups that have matching items
      setOpenGroups(filteredGroups.map(group => group.name));
    } else if (isSearching) {
      // Only reset groups when exiting search mode
      setIsSearching(false);
    }
  }, [searchQuery, filteredGroups]);

  // Handle accordion value changes
  const handleAccordionChange = (value: string[]) => {
    // Only update if we're not actively searching
    if (!searchQuery) {
      setOpenGroups(value);
    } else {
      // During search, we need to preserve expanded groups that have matches
      const matchingGroups = filteredGroups.map(group => group.name);
      // Keep all matching groups open while allowing manual toggling of others
      const newValue = value.filter(group => matchingGroups.includes(group));
      if (newValue.length < matchingGroups.length) {
        // If user is closing a search result group, allow that
        setOpenGroups(newValue);
      } else {
        // User is opening a new group during search
        setOpenGroups(value);
      }
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    activeItem,
    setActiveItem,
    openGroups,
    setOpenGroups,
    isSearching,
    filteredGroups,
    handleAccordionChange
  };
} 
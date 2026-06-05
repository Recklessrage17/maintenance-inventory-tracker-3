#!/usr/bin/env node
const baseUrl = 'http://localhost:4173';
(async () => {
  try {
    const res = await fetch(`${baseUrl}/api/app-data`);
    const json = await res.json();
    let data = json.data;
    const now = new Date().toISOString();

    if (!data) {
      data = {
        app: 'maintenance-inventory-tracker',
        version: '3.0.0-test',
        lastSavedAt: now,
        items: [],
        locations: [],
        vendors: [],
        stockChanges: [],
        requisitionMadeRecords: [],
        deletedRecords: [],
        auditLog: [],
        settings: {}
      };
    }

    // Add test item
    const testItem = { id: 'test-item-1', name: 'Automated Test Item', quantity: 7 };
    data.items = data.items || [];
    data.items.push(testItem);
    data.version = (data.version || '3.0.0') + '-test';
    data.lastSavedAt = new Date().toISOString();

    console.log('Putting new snapshot with test item...');
    const putRes = await fetch(`${baseUrl}/api/app-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log('PUT response status', putRes.status);
    console.log(await putRes.text());

    // Edit the item
    console.log('Editing test item...');
    const item = data.items.find(i => i.id === 'test-item-1');
    if (item) {
      item.quantity = 42;
      item.name = 'Automated Test Item (edited)';
      data.lastSavedAt = new Date().toISOString();

      const putRes2 = await fetch(`${baseUrl}/api/app-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      console.log('Second PUT status', putRes2.status);
      console.log(await putRes2.text());
    } else {
      console.warn('Test item not found after insert');
    }

    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Error during test script:', err);
    process.exit(2);
  }
})();

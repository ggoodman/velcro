export const files = {
  'package.json':
    JSON.stringify(
      {
        name: 'test',
        version: '0.0.0',
        dependencies: {
          'ag-grid-community': '^21.2.1',
          'ag-grid-react': '^21.2.1',
          react: '^16.9.0',
          'react-dom': '^16.9.0',
        },
      },
      null,
      2
    ) + '\n',
  'index.jsx':
    `
import React, { Component } from 'react';
import { render } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/dist/styles/ag-grid.css';
import 'ag-grid-community/dist/styles/ag-theme-balham.css';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      columnDefs: [
        {
          headerName: "Make", field: "make"
        }, {
          headerName: "Model", field: "model"
        }, {
          headerName: "Price", field: "price"
        }
      ],
      rowData: [
        {
          make: "Toyota", model: "Celica", price: 35000
        }, {
          make: "Ford", model: "Mondeo", price: 32000
        }, {
          make: "Porsche", model: "Boxter", price: 72000
        }
      ]
    }
  }

  render() {
    return (
      <div 
        className="ag-theme-balham"
        style={{ 
        height: '500px', 
        width: '600px' }} 
      >
        <AgGridReact
          columnDefs={this.state.columnDefs}
          rowData={this.state.rowData}>
        </AgGridReact>
      </div>
    );
  }
}

render(<App />, document.getElementById('root'));
        `.trim() + '\n',
};

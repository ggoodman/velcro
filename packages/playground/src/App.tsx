import styled from '@emotion/styled';
import React from 'react';

import Sidebar from './Sidebar';

const WorkbenchWrap = styled.div`
  display: flex;
  flex-direction: row;

  & > ${Sidebar} {
    flex: 1 0 20%;
    min-width: 200px;
  }
`;

const App: React.FC = () => {
  return (
    <WorkbenchWrap>
      <Sidebar></Sidebar>
      Hello
    </WorkbenchWrap>
  );
};

export default App;

import styled from '@emotion/styled/macro';
import React from 'react';

const Preview: React.FC<{ className?: string }> = props => {
  return <div className={props.className}>Preview</div>;
};

export default styled(Preview)`
  border-right: 1px solid #ccc;
`;

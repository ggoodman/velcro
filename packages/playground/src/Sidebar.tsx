import styled from '@emotion/styled';
import React from 'react';

const SidebarWrap = styled.div``;

const Sidebar: React.FC<{ className?: string }> = props => {
  return <SidebarWrap className={props.className}></SidebarWrap>;
};

export default styled(Sidebar)``;

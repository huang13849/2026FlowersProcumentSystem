import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout, Menu, Typography, Card, Row, Col, Statistic } from 'antd';
import { ShoppingCartOutlined, TeamOutlined, DashboardOutlined, SettingOutlined, CloudServerOutlined } from '@ant-design/icons';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: 'products', icon: <ShoppingCartOutlined />, label: '商品中心' },
  { key: 'suppliers', icon: <TeamOutlined />, label: '供应商中心' },
  { key: 'dashboard', icon: <DashboardOutlined />, label: '数据看板' },
  { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
];

function DashboardPage() {
  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="商品服务" value="3001" prefix={<CloudServerOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="供应商服务" value="3002" prefix={<CloudServerOutlined />} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="商品管理" size="small" extra={<a href="http://100.96.54.109:31001" target="_blank">打开 ›</a>}>
            <iframe src="http://100.96.54.109:31001" style={{ width: '100%', height: 400, border: '1px solid #f0f0f0', borderRadius: 4 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="供应商管理" size="small" extra={<a href="http://100.96.54.109:31002" target="_blank">打开 ›</a>}>
            <iframe src="http://100.96.54.109:31002" style={{ width: '100%', height: 400, border: '1px solid #f0f0f0', borderRadius: 4 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

const App: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1a1a2e', borderRadius: 6 } }}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
          <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>
            {collapsed ? '🌺' : '🌺 花卉供应链'}
          </div>
          <Menu theme="dark" mode="inline" defaultSelectedKeys={['dashboard']}
            items={menuItems}
            onClick={({ key }) => {
              if (key === 'products') window.open('http://100.96.54.109:31001', '_blank');
              if (key === 'suppliers') window.open('http://100.96.54.109:31002', '_blank');
            }}
          />
        </Sider>
        <Layout>
          <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>花卉采购系统 - 供应链管理平台</Typography.Title>
          </Header>
          <Content style={{ margin: 16, padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};
export default App;

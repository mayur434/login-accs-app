/* 
* <license header>
*/

import React from 'react'
import { NavLink } from 'react-router-dom'
import Settings from '@spectrum-icons/workflow/Settings'
import DevicePhone from '@spectrum-icons/workflow/DevicePhone'
import Email from '@spectrum-icons/workflow/Email'

function SideBar () {
  return (
    <nav className='AdminSideNav'>
      <div className='AdminSideNav-header'>
        <span className='AdminSideNav-logo'>Login Module</span>
        <span className='AdminSideNav-version'>v1.0</span>
      </div>
      <ul className='AdminSideNav-list'>
        <li className='AdminSideNav-section'>Configuration</li>
        <li className='AdminSideNav-item'>
          <NavLink
            className={({ isActive }) => `AdminSideNav-link ${isActive ? 'is-active' : ''}`}
            end
            to='/admin'
          >
            <Settings size='S' />
            <span>Application Setup</span>
          </NavLink>
        </li>
        <li className='AdminSideNav-section'>Communication</li>
        <li className='AdminSideNav-item'>
          <NavLink
            className={({ isActive }) => `AdminSideNav-link ${isActive ? 'is-active' : ''}`}
            to='/admin/sms'
          >
            <DevicePhone size='S' />
            <span>SMS Setup</span>
          </NavLink>
        </li>
        <li className='AdminSideNav-item'>
          <NavLink
            className={({ isActive }) => `AdminSideNav-link ${isActive ? 'is-active' : ''}`}
            to='/admin/email'
          >
            <Email size='S' />
            <span>Email Setup</span>
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

export default SideBar
